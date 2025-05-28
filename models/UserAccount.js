module.exports = (sequelize, DataTypes) => {
    const UserAccount = sequelize.define('UserAccount', {
      facebookUserId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      name: DataTypes.STRING,
      avatar: DataTypes.STRING,
      accessToken: DataTypes.TEXT,
      expiresAt: DataTypes.DATE
    });
  
    return UserAccount;
  };
  