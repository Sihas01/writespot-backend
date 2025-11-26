const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

// AUTH ROUTES
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/verify-otp", authController.verifyOtp);
router.post("/resend-otp", authController.resendOtp);
router.post("/forgot-password", authController.forgotPassword);
router.get("/reset-password/:token", (req, res) => {
  const { token } = req.params;
  res.redirect(`${process.env.API}/reset-password/${token}`);
});
router.post("/reset-password/:token", authController.resetPassword);



// Example of protected route
router.get("/profile", auth, (req, res) => {
  res.json({ msg: "Profile accessed", user: req.user });
});

// Example of protected + role-specific route
router.get("/teacher-area", auth, role(["teacher"]), (req, res) => {
  res.json({ msg: "Welcome Teacher!" });
});

module.exports = router;
