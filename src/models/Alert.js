const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../db");

class Alert extends Model {}

Alert.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    apiKeyId: { type: DataTypes.INTEGER, allowNull: true },

    kind: { type: DataTypes.STRING(48), allowNull: false }, // spend_80 | spend_100 | rate_spike | auth_failures
    severity: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "warning" },
    message: { type: DataTypes.TEXT, allowNull: false },
    read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    createdAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: "Alert",
    tableName: "alerts",
    underscored: true,
    timestamps: false,
  }
);

module.exports = Alert;
