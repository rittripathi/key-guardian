const express = require("express");
const { Alert, ApiKey } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

router.get(
  "/alerts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await Alert.findAll({
      where: { userId: req.user.id },
      include: [{ model: ApiKey, as: "key", attributes: ["alias"], required: false }],
      order: [["createdAt", "DESC"]],
      limit: 200,
    });

    // Template expects a list of [alert, alias] pairs, matching the
    // Python router's `select(Alert, ApiKey.alias).outerjoin(...)` rows.
    const alerts = rows.map((alert) => [alert, alert.key ? alert.key.alias : null]);

    res.render("alerts.html", { user: req.user, alerts });
  })
);

router.post(
  "/alerts/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    await Alert.update({ read: true }, { where: { userId: req.user.id } });
    res.redirect(303, "/alerts");
  })
);

module.exports = router;
