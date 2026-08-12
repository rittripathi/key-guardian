const crypto = require("crypto");
const argon2 = require("argon2");
const { settings } = require("./config");

// ---------- passwords / passphrases ----------

async function hashSecret(raw) {
  return argon2.hash(raw, { type: argon2.argon2id });
}

async function verifySecret(hashed, raw) {
  if (!hashed) return false;
  try {
    return await argon2.verify(hashed, raw);
  } catch (err) {
    // any argon2 failure (malformed hash, mismatch) means "no"
    return false;
  }
}

// ---------- sessions ----------
//
// A small hand-rolled equivalent of itsdangerous's URLSafeTimedSerializer:
// base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature).
// The payload carries an `iat` (issued-at) timestamp so we can enforce
// settings.sessionMaxAge the same way the Python side used `max_age`.

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(str) {
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  return Buffer.from(padded, "base64");
}

function sign(payloadB64) {
  return base64url(crypto.createHmac("sha256", settings.secretKey).update(payloadB64).digest());
}

function makeSession(userId) {
  const payload = { uid: userId, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

function readSession(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;

    const expected = sign(payloadB64);
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
    if (typeof payload.iat !== "number") return null;

    const age = Math.floor(Date.now() / 1000) - payload.iat;
    if (age > settings.sessionMaxAge) return null;

    return payload.uid !== undefined && payload.uid !== null ? Number(payload.uid) : null;
  } catch (err) {
    return null;
  }
}

// ---------- provider key encryption (AES-256-GCM) ----------

function aesKey() {
  const raw = (settings.encryptionKey || "").trim();
  if (!raw) {
    // Deterministic dev fallback so the app boots; production must set ENCRYPTION_KEY.
    return crypto.createHash("sha256").update(settings.secretKey).digest();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  return key;
}

function encryptSecret(plaintext) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout matches Python's `cryptography` AESGCM: nonce + ciphertext + tag.
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

function decryptSecret(blob) {
  const raw = Buffer.from(blob, "base64");
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Helper for the README: prints a valid ENCRYPTION_KEY. */
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("base64");
}

module.exports = {
  hashSecret,
  verifySecret,
  makeSession,
  readSession,
  encryptSecret,
  decryptSecret,
  generateEncryptionKey,
};
