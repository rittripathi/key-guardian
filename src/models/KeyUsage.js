const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../db");

class KeyUsage extends Model {}

KeyUsage.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    apiKeyId: { type: DataTypes.INTEGER, allowNull: false },

    path: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    model: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    statusCode: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    promptTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    completionTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    costUsd: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.0 },
    latencyMs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isTest: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    clientIp: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "" },

    createdAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: "KeyUsage",
    tableName: "key_usage",
    underscored: true,
    timestamps: false,
  }
);

module.exports = KeyUsage;
