const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

// AUTH ROUTES
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/verify-otp", authController.verifyOtp);

// Example of protected route
router.get("/profile", auth, (req, res) => {
  res.json({ msg: "Profile accessed", user: req.user });
});

// Example of protected + role-specific route
router.get("/teacher-area", auth, role(["teacher"]), (req, res) => {
  res.json({ msg: "Welcome Teacher!" });
});

module.exports = router;
