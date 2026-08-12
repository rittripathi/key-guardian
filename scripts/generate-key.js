#!/usr/bin/env node
/**
 * Prints a fresh ENCRYPTION_KEY (base64 of 32 random bytes).
 * Usage: npm run generate-key
 */
const { generateEncryptionKey } = require("../src/security");

console.log(generateEncryptionKey());
