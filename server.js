require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const { scheduleJob, scheduledJobs, cancelJob } = require('node-schedule');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false, // Tắt log query trong console
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Kiểm tra kết nối database
(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Kết nối database thành công');
  } catch (error) {
    console.error('❌ Lỗi kết nối database:', error);
    process.exit(1); // Thoát nếu không kết nối được
  }
})();

// Khởi tạo model
const CommentTemplate = require('./models/CommentTemplate')(sequelize, Sequelize.DataTypes);
const UserAccount = require('./models/UserAccount')(sequelize, Sequelize.DataTypes);

const app = express();
const PORT = process.env.PORT || 3000;
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ hỗ trợ file ảnh (JPEG, PNG, GIF) và video (MP4, MOV)'), false);
  }
};
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter
});
const scheduledPosts = {};

// Đồng bộ database
(async () => {
  try {
    await sequelize.sync({ alter: true }); // Thêm alter: true để tự động cập nhật schema
    console.log('Đồng bộ model thành công');
  } catch (error) {
    console.error('Lỗi đồng bộ model:', error);
  }
})();

// Cấu hình middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Biến toàn cục lưu trữ tạm token
let pageAccessToken = null;

// Biến toàn cục bật/tắt AI chatbot
let aiReplyEnabled = true; // Mặc định bật

// Trang chủ với form đăng bài
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Điều hướng đến Facebook để xác thực
app.get('/auth/facebook', (req, res) => {
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.APP_ID}&redirect_uri=${process.env.REDIRECT_URI}&scope=pages_manage_posts,pages_read_engagement,pages_show_list,pages_manage_metadata,pages_manage_engagement`;
    res.redirect(authUrl);
});

// Callback xử lý token
app.get('/auth/facebook/callback', async (req, res) => {
    try {
      const { code } = req.query;
      
      if (!code) {
        throw new Error('Không nhận được code từ Facebook');
      }
  
      // 1. Lấy user access token
      const tokenResponse = await axios.get(
        `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.APP_ID}&client_secret=${process.env.APP_SECRET}&code=${code}&redirect_uri=${process.env.REDIRECT_URI}`
      );
  
      const userAccessToken = tokenResponse.data.access_token;
      console.log('User Access Token:', userAccessToken); // Debug
  
      // 2. Lấy danh sách trang quản lý
      const pagesResponse = await axios.get(
        `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
      );
      
      const pages = pagesResponse.data.data;
      console.log('Danh sách trang:', pages); // Debug
  
      if (!pages || pages.length === 0) {
        throw new Error('Tài khoản không quản lý trang nào');
      }
  
      // 3. Tìm trang theo PAGE_ID
      const targetPage = pages.find(page => page.id === process.env.PAGE_ID);
      if (!targetPage) {
        throw new Error(`Không tìm thấy trang với ID ${process.env.PAGE_ID} hoặc không có quyền`);
      }
  
      pageAccessToken = targetPage.access_token;
      console.log('Page Access Token:', pageAccessToken); // Debug

      // Đăng ký webhook cho Page
      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/subscribed_apps`,
          {
            subscribed_fields: ['feed']
          },
          {
            params: {
              access_token: pageAccessToken
            }
          }
        );
        console.log('✅ Đã đăng ký webhook cho Page thành công!');
      } catch (err) {
        console.error('❌ Lỗi khi đăng ký webhook cho Page:', err.response?.data || err.message);
      }
      try {
        await axios.delete(
          `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/subscribed_apps`,
          {
            params: {
              access_token: pageAccessToken
            }
          }
        );
        console.log('🧹 Đã gỡ đăng ký webhook cũ (reset)');
      } catch (err) {
        console.error('❌ Lỗi khi gỡ đăng ký cũ:', err.response?.data || err.message);
      }
      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/subscribed_apps`,
          {
            subscribed_fields: ['feed', 'conversations']
          },
          {
            params: {
              access_token: pageAccessToken
            }
          }
        );
        console.log('✅ Đã đăng ký webhook cho Page thành công (lại)!');
      } catch (err) {
        console.error('❌ Lỗi khi đăng ký lại webhook:', err.response?.data || err.message);
      }            
      
      res.redirect('/?auth=success');
    } catch (error) {
      console.error('Chi tiết lỗi:', {
        message: error.message,
        response: error.response?.data,
        stack: error.stack
      });
      res.redirect('/?auth=failed&reason=' + encodeURIComponent(error.message));
    }
});

// API đăng bài
app.post('/api/post', async (req, res) => {
  try {
    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    const { message, mediaUrl } = req.body;
    
    let postData = { message, access_token: pageAccessToken };
    
    // Nếu có ảnh, đăng bài dạng photo
    if (mediaUrl) {
      postData.url = mediaUrl;
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/photos`,
        postData
      );
      return res.json({ 
        success: true, 
        postId: response.data.id,
        type: 'photo'
      });
    }
    
    // Đăng bài thường
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/feed`,
      postData
    );
    
    res.json({ 
      success: true, 
      postId: response.data.id,
      type: 'status'
    });
  } catch (error) {
    console.error('Posting error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Đăng bài thất bại',
      details: error.response?.data?.error || error.message
    });
  }
});

// Xử lý upload cả ảnh và video
app.post('/api/upload', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Vui lòng chọn file phương tiện' });
    }

    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    const { message } = req.body;

    const isVideo = req.file.mimetype.startsWith('video/');
    const apiEndpoint = isVideo 
      ? `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/videos`
      : `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/photos`;

    const formData = new FormData();
    formData.append('access_token', pageAccessToken);
    formData.append('message', message || '');

    if (isVideo) {
      // Thêm thông tin đặc biệt cho video
      formData.append('title', 'Video đăng từ Auto Marketing Tool');
      formData.append('published', 'true');
    }

    formData.append('source', fs.createReadStream(req.file.path));

    const response = await axios.post(apiEndpoint, formData, {
      headers: {
        ...formData.getHeaders(),
        'Content-Type': 'multipart/form-data'
      },
      // Timeout dài hơn cho video
      timeout: isVideo ? 60000 : 10000
    });

    // Xóa file tạm
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      postId: response.data.id,
      type: isVideo ? 'video' : 'photo',
      duration: isVideo ? response.data.duration : null
    });
  } catch (error) {
    console.error('Upload error:', error.response?.data || error.message);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({
      error: `Upload ${isVideo ? 'video' : 'ảnh'} thất bại`,
      details: error.response?.data?.error || error.message
    });
  }
});

// Thêm endpoint mới cho lên lịch bài đăng
app.post('/api/schedule', upload.single('media'), async (req, res) => {
  try {
    const { message, scheduled_time, mediaUrl } = req.body;
    const file = req.file;

    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    const scheduledDate = new Date(scheduled_time);
    if (scheduledDate < new Date()) {
      return res.status(400).json({ error: 'Thời gian hẹn lịch phải ở tương lai' });
    }

    const postId = `post_${Date.now()}`;

    // Lưu thông tin bài đăng
    scheduledPosts[postId] = {
      postId, // Thêm trường này
      message,
      mediaUrl,
      file,
      scheduled_time: scheduledDate,
      status: 'scheduled'
    };

    // Lên lịch đăng bài
    const job = scheduleJob(postId, scheduledDate, async () => {
      try {
        let response;
        if (file) {
          const isVideo = file.mimetype.startsWith('video/');
          const apiEndpoint = isVideo 
            ? `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/videos`
            : `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/photos`;

          const formData = new FormData();
          formData.append('access_token', pageAccessToken);
          formData.append('message', message);
          if (isVideo) {
            formData.append('title', 'Video đăng từ Auto Marketing Tool');
            formData.append('published', 'true');
          }
          formData.append('source', fs.createReadStream(file.path));

          response = await axios.post(apiEndpoint, formData, {
            headers: formData.getHeaders(),
            timeout: isVideo ? 60000 : 10000
          });
          fs.unlinkSync(file.path);
        } else if (mediaUrl) {
          const isVideo = mediaUrl.match(/\.(mp4|mov|avi)$/i);
          const endpoint = isVideo 
            ? `${process.env.PAGE_ID}/videos`
            : `${process.env.PAGE_ID}/photos`;
          
          const postData = {
            message,
            access_token: pageAccessToken,
            [isVideo ? 'file_url' : 'url']: mediaUrl
          };

          response = await axios.post(`https://graph.facebook.com/v19.0/${endpoint}`, postData);
        } else {
          response = await axios.post(`https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/feed`, {
            message,
            access_token: pageAccessToken
          });
        }

        scheduledPosts[postId].status = 'posted';
        scheduledPosts[postId].post_id = response.data.id;
        scheduledPosts[postId].posted_at = new Date();
      } catch (error) {
        scheduledPosts[postId].status = 'failed';
        scheduledPosts[postId].error = error.message;
        if (file) fs.unlinkSync(file.path);
      }
    });

    res.json({
      success: true,
      postId,
      scheduled_time: scheduledDate,
      status: 'scheduled'
    });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({
      error: 'Lỗi khi lên lịch bài đăng',
      details: error.message
    });
  }
});

// Cập nhật endpoint lấy danh sách bài đăng đã lên lịch
app.get('/api/scheduled', (req, res) => {
  const posts = Object.values(scheduledPosts)
    .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
  res.json(posts);
});

// API quản lý comment mẫu
app.post('/api/comment-templates', async (req, res) => {
  try {
    const { content } = req.body;
    const template = await CommentTemplate.create({ 
      content,
      userId: 'user1' // Thay bằng user thực tế sau
    });
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/comment-templates', async (req, res) => {
  try {
    const templates = await CommentTemplate.findAll();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API tự động comment
app.post('/api/auto-comment', async (req, res) => {
  try {
    const { postId } = req.body;
    
    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    // Lấy ngẫu nhiên 1 comment mẫu
    const templates = await CommentTemplate.findAll();
    if (templates.length === 0) {
      return res.status(400).json({ error: 'Chưa có comment mẫu nào' });
    }

    const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
    
    // Gửi comment lên Facebook
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${postId}/comments`,
      {
        message: randomTemplate.content,
        access_token: pageAccessToken
      }
    );

    res.json({
      success: true,
      commentId: response.data.id,
      templateUsed: randomTemplate.id
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Tự động comment thất bại',
      details: error.response?.data?.error || error.message
    });
  }
});

// API xóa comment mẫu
app.delete('/api/comment-templates/:id', async (req, res) => {
  try {
    await CommentTemplate.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API lấy comment mẫu theo ID
app.get('/api/comment-templates/:id', async (req, res) => {
  try {
    const template = await CommentTemplate.findByPk(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Không tìm thấy comment mẫu' });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/page-posts', async (req, res) => {
  try {
    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực' });
    }

    const result = await axios.get(
      `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/posts?access_token=${pageAccessToken}&limit=10`
    );
    res.json(result.data.data);
  } catch (error) {
    console.error('❌ Lỗi khi lấy bài đăng:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Không thể lấy danh sách bài đăng',
      details: error.response?.data?.error || error.message
    });
  }
});

// OAuth Flow Login FB cá nhân
// 1. Route điều hướng đến FB để login
app.get('/auth/user', (req, res) => {
  const redirectUri = `${process.env.BASE_URL}/auth/user/callback`;
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.APP_ID}&redirect_uri=${redirectUri}&scope=public_profile,pages_read_engagement`;
  res.redirect(authUrl);
});

// 2. Xử lý Callback
app.get('/auth/user/callback', async (req, res) => {
  const code = req.query.code;

  if (!code) return res.redirect('/?auth=failed&reason=No code received');

  try {
    // Lấy access token ngắn hạn
    const tokenResponse = await axios.get(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.APP_ID}&client_secret=${process.env.APP_SECRET}&redirect_uri=${process.env.BASE_URL}/auth/user/callback&code=${code}`
    );

    const accessToken = tokenResponse.data.access_token;

    // Lấy thông tin user
    const userResponse = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,picture&access_token=${accessToken}`
    );

    const { id, name, picture } = userResponse.data;

    // Lưu vào DB
    await UserAccount.upsert({
      facebookUserId: id,
      name,
      avatar: picture.data.url,
      accessToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1h (tạm tính)
    });

    res.redirect('/?auth_user=success');
  } catch (err) {
    console.error('❌ Lỗi xác thực người dùng:', err.response?.data || err.message);
    res.redirect('/?auth_user=failed');
  }
});

// API danh sách tài khoản người dùng đã lưu
app.get('/api/user-accounts', async (req, res) => {
  try {
    const users = await UserAccount.findAll();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto like
app.post('/api/auto-like', async (req, res) => {
  try {
    const { postId } = req.body;

    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${postId}/likes`,
      null,
      {
        params: {
          access_token: pageAccessToken
        }
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Lỗi auto like:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Auto like thất bại',
      details: error.response?.data?.error || error.message
    });
  }
});

// Auto share
app.post('/api/auto-share', async (req, res) => {
  try {
    const { postId } = req.body;

    if (!pageAccessToken) {
      return res.status(401).json({ error: 'Chưa xác thực với Facebook' });
    }

    const postUrl = `https://www.facebook.com/${process.env.PAGE_ID}/posts/${postId}`;

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PAGE_ID}/feed`,
      {
        link: postUrl,
        access_token: pageAccessToken
      }
    );

    res.json({ success: true, sharedPostId: response.data.id });
  } catch (error) {
    console.error('❌ Lỗi auto share:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Auto share thất bại',
      details: error.response?.data?.error || error.message
    });
  }
});

// Webhook xác minh (GET)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post('/webhook', (req, res) => {
  console.log('📥 DỮ LIỆU THÔ NHẬN ĐƯỢC:', JSON.stringify(req.body, null, 2));
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(async function(entry) {
      const event = entry.changes?.[0];
      if (!event) return;

      console.log('📩 Nhận sự kiện Webhook:', JSON.stringify(event, null, 2));

      if (
        event.field === 'feed' && 
        event.value.item === 'comment' &&
        event.value.from.id !== process.env.PAGE_ID
      ) {
        const commentId = event.value.comment_id;
        const message = event.value.message;
        const from = event.value.from;

        console.log(`💬 New comment from ${from.name}: "${message}" (commentId: ${commentId})`);

        // Chỉ trả lời nếu AI bật
        if (!aiReplyEnabled) {
          console.log("🤖 AI chatbot đang TẮT – Không tự động trả lời comment này.");
          return;
        }

        // Xử lý trả lời comment
        try {
          // Gửi câu hỏi đến OpenRouter (DeepSeek V3 0324)
          const aiRes = await axios.post(
            process.env.DEEPSEEK_API_URL,
            {
              model: process.env.DEEPSEEK_MODEL,
              messages: [
                { role: "system", content: "Bạn là trợ lý thân thiện cho một fanpage bán hàng. Hãy trả lời ngắn gọn và chuyên nghiệp." },
                { role: "user", content: message }
              ],
              temperature: 0.7,
              max_tokens: 200
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://facebook.com/",
                "X-Title": "FB Page Bot"
              }
            }
          );

          const aiReply = aiRes.data.choices[0].message.content;
          console.log(`🤖 AI reply: ${aiReply}`);

          // Gửi trả lời bình luận lên Facebook
          await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/comments`,
            {
              message: aiReply,
              access_token: pageAccessToken
            }
          );

          console.log(`✅ Replied to comment ${commentId}`);
        } catch (err) {
          console.error("❌ Lỗi khi xử lý AI comment:", err.response?.data || err.message);
        }
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// API lấy trạng thái bật/tắt AI
app.get('/api/ai-reply-enabled', (req, res) => {
  res.json({ enabled: aiReplyEnabled });
});

// API cập nhật trạng thái bật/tắt AI
app.post('/api/ai-reply-enabled', express.json(), (req, res) => {
  const { enabled } = req.body;
  aiReplyEnabled = !!enabled;
  res.json({ enabled: aiReplyEnabled });
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});