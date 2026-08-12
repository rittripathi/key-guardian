const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../db");

class KeyLimit extends Model {}

KeyLimit.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    apiKeyId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

    rateLimit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // 0 = off
    rateWindowSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
    rateMode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "block" }, // block | notify

    spendCapUsd: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.0 }, // 0 = off
    spendMode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "block" },

    updatedAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: "KeyLimit",
    tableName: "key_limits",
    underscored: true,
    // Mirrors SQLAlchemy's onupdate=func.now(): Sequelize stamps updated_at
    // on every save/update. There's no created_at column on this table.
    timestamps: true,
    createdAt: false,
    updatedAt: "updatedAt",
  }
);

module.exports = KeyLimit;
