const User = require("./User");
const ApiKey = require("./ApiKey");
const KeyLimit = require("./KeyLimit");
const KeyUsage = require("./KeyUsage");
const Alert = require("./Alert");

User.hasMany(ApiKey, { foreignKey: "userId", as: "keys" });
ApiKey.belongsTo(User, { foreignKey: "userId", as: "user" });

ApiKey.hasOne(KeyLimit, { foreignKey: "apiKeyId", as: "limit" });
KeyLimit.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "key" });

ApiKey.hasMany(KeyUsage, { foreignKey: "apiKeyId", as: "usageRows" });
KeyUsage.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "key" });

User.hasMany(Alert, { foreignKey: "userId", as: "alerts" });
Alert.belongsTo(User, { foreignKey: "userId", as: "user" });
ApiKey.hasMany(Alert, { foreignKey: "apiKeyId", as: "alerts" });
Alert.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "key" });

module.exports = { User, ApiKey, KeyLimit, KeyUsage, Alert };
