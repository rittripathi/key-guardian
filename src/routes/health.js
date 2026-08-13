const express = require("express");
const { sequelize } = require("../db");
const { getRedis } = require("../cache");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/ping", (req, res) => {
  res.status(200).json({ status: "ok" });
});

router.get(
  "/healthz",
  asyncHandler(async (req, res) => {
    const status = { status: "ok", db: "ok", redis: "ok" };

    try {
      await sequelize.query("SELECT 1");
    } catch (err) {
      status.db = `error: ${err.constructor.name}`;
      status.status = "degraded";
    }

    try {
      await getRedis().ping();
    } catch (err) {
      status.redis = `error: ${err.constructor.name}`;
      status.status = "degraded";
    }

    res.json(status);
  })
);

module.exports = router;