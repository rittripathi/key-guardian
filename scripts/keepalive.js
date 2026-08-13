
const { settings } = require("../src/config");

async function pingHealth() {
  const url = settings.publicBaseUrl.replace(/\/+$/, "") + "/ping";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      console.log(`ping -> ${resp.status}`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`ping failed: ${err.message}`);
  }
}

async function main() {
  await pingHealth();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });