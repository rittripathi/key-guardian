const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../db");

class ApiKey extends Model {}

ApiKey.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },

    // Globally unique, not just per-user: /proxy/{alias}/... has no user context to
    // scope by, so two users sharing an alias would otherwise collide and one user's
    // traffic could silently be routed through the other user's key.
    alias: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    provider: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "openai" },
    baseUrl: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },

    // AES-256-GCM ciphertext of the provider secret
    secretCiphertext: { type: DataTypes.TEXT, allowNull: false },
    secretLast4: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "" },

    // optional passphrase: caller sends "<alias><passphrase>"
    passphraseHash: { type: DataTypes.TEXT, allowNull: true },

    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    createdAt: { type: DataTypes.DATE },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: "ApiKey",
    tableName: "api_keys",
    underscored: true,
    timestamps: false,
  }
);

module.exports = ApiKey;
