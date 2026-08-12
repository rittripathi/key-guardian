const express = require("express");
const { settings } = require("../config");
const { User } = require("../models");
const { getUserByEmail } = require("../middleware/auth");
const { hashSecret, verifySecret, makeSession } = require("../security");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

function setSessionCookie(res, userId) {
  res.cookie(settings.sessionCookie, makeSession(userId), {
    maxAge: settings.sessionMaxAge * 1000, // ms
    httpOnly: true,
    sameSite: "lax",
    secure: settings.publicBaseUrl.startsWith("https://"),
    path: "/",
  });
}

router.get("/login", (req, res) => {
  res.render("login.html", { error: null });
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await getUserByEmail(email || "");
    if (!user || !(await verifySecret(user.passwordHash, password || ""))) {
      return res
        .status(401)
        .render("login.html", { error: "Wrong email or password." });
    }
    setSessionCookie(res, user.id);
    return res.redirect(303, "/");
  })
);

router.get("/register", (req, res) => {
  res.render("register.html", { error: null });
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = req.body.password || "";

    if (password.length < 8) {
      return res
        .status(400)
        .render("register.html", { error: "Password must be at least 8 characters." });
    }
    if (await getUserByEmail(email)) {
      return res
        .status(400)
        .render("register.html", { error: "That email is already registered." });
    }

    const user = await User.create({ email, passwordHash: await hashSecret(password) });
    setSessionCookie(res, user.id);
    return res.redirect(303, "/");
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie(settings.sessionCookie, { path: "/" });
  res.redirect(303, "/login");
});

module.exports = router;
