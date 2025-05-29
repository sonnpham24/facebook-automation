# Facebook Automation Tool 🤖📘

Một công cụ **tự động hóa marketing cho Facebook Page**, bao gồm các tính năng:

- ✅ Đăng bài tự động (ngay hoặc hẹn lịch)
- ✅ Comment tự động bằng AI (DeepSeek Chatbot)
- ✅ Webhook nhận bình luận trên page
- ✅ Hệ thống mẫu comment và quản lý tài khoản
- ✅ Giao diện đơn giản để thao tác

---

## 🚀 Công nghệ sử dụng

- **Node.js** + Express
- **Sequelize** + PostgreSQL
- **Facebook Graph API**
- **Webhook Facebook**
- **DeepSeek API** (qua OpenRouter)
- **Ngrok** (cho localhost HTTPS tunneling)
- Frontend: HTML + JS thuần

---

## 📦 Cài đặt và chạy local

### 1. Clone dự án
git clone https://github.com/your-username/facebook-automation-tool.git
cd facebook-automation-tool

### 2. Cài đặt thư viện
npm install

### 3. Cấu hình .env
Tạo file .env với nội dung như sau:

APP_ID=YOUR_FACEBOOK_APP_ID
APP_SECRET=YOUR_FACEBOOK_APP_SECRET
PAGE_ID=YOUR_PAGE_ID
REDIRECT_URI=https://your-ngrok-url/auth/facebook/callback
FB_VERIFY_TOKEN=your_custom_verify_token
BASE_URL=https://your-ngrok-url

# PostgreSQL config
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_db
DB_USER=your_user
DB_PASSWORD=your_password

# DeepSeek (qua OpenRouter)
DEEPSEEK_API_KEY=sk-openrouter-xxxxxxxx
DEEPSEEK_API_URL=https://openrouter.ai/api/v1/chat/completions
DEEPSEEK_MODEL=deepseek/deepseek-chat-v3-0324:free
⚠️ Thay thế your-ngrok-url bằng URL do Ngrok cung cấp (dạng https://abcd-1234.ngrok-free.app)

## ▶️ Khởi động

### 1. Chạy database PostgreSQL (nếu chưa có)
createdb your_db

### 2. Chạy server
node server.js

### 3. Mở giao diện
Truy cập: http://localhost:3000 hoặc https://<ngrok-url>

## 💡 Tính năng hiện tại
Tính năng	Trạng thái
Đăng bài ngay	✅ OK
Đăng bài theo lịch	✅ OK
Upload ảnh/video	✅ OK
Comment mẫu (CRUD)	✅ OK
Auto comment AI	✅ OK
Webhook nhận bình luận	✅ OK
Chatbot AI trả lời bình luận	✅ OK
Ngăn vòng lặp phản hồi	✅ Đã xử lý
Đăng nhập Page (OAuth)	✅ OK

## 🔮 Định hướng sắp tới
 Lưu lịch sử phản hồi vào database

 Dashboard quản lý comment

 Cài đặt bật/tắt chatbot

 Spin nội dung hoặc multi-template

 Chống chặn IP bằng proxy

 Tự động like/share bài viết bằng nhiều tài khoản

## 👨‍💻 Tác giả
Phạm Công Sơn — Sinh viên trường Đại học Bách Khoa Hà Nội
