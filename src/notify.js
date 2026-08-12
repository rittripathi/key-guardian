/**
 * Alert creation plus outbound delivery channels.
 */
const { settings } = require("./config");
const { Alert } = require("./models");

async function sendTelegram(text) {
  if (!settings.telegramBotToken || !settings.telegramChatId) return;
  const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // alerting must never break the request
    console.warn("telegram delivery failed:", err.message);
  }
}

async function notify({ userId, apiKeyId, kind, message, severity = "warning" }) {
  await Alert.create({
    userId,
    apiKeyId: apiKeyId ?? null,
    kind,
    severity,
    message,
  });
  const prefix = severity === "warning" ? "\u26a0\ufe0f" : "\ud83d\uded1";
  await sendTelegram(`${prefix} <b>KeyShort</b>\n${message}`);
}

module.exports = { sendTelegram, notify };
