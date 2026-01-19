const User = require("../models/user");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
require("dotenv").config();

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

// Allow local dev without working SMTP creds.
const EMAIL_DEV_MODE = String(process.env.EMAIL_DEV_MODE).toLowerCase() === "true";
const sendMailSafe = async (options) => {
  if (EMAIL_DEV_MODE) {
    console.log("[DEV_EMAIL_MODE] Email send skipped; payload:", {
      to: options.to,
      subject: options.subject,
      preview: options.html ? options.html.slice(0, 200) : options.text,
    });
    return;
  }
  return transporter.sendMail(options);
};

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  // ==================== REGISTER ====================
  register: async (req, res) => {
    try {
      const { name, email, password, confirmPassword, role } = req.body;

      // Validate required fields
      if (!name || !email || !password || !confirmPassword || !role) {
        return res.status(400).json({ msg: "All fields are required" });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ msg: "Passwords do not match" });
      }
      if (password.length < 6) {
        return res.status(400).json({ msg: "Password must be at least 6 characters" });
      }

      const normalizedEmail = email.toLowerCase().trim();


      // Strict role validation
      if (role !== "reader" && role !== "author") {
        return res.status(400).json({ msg: "Invalid role. Only 'reader' or 'author' allowed." });
      }
      const backendRole = role;

      // Check if the email already exists for the same role
      const existingUserWithRole = await User.findOne({ email: normalizedEmail, role: backendRole });
      if (existingUserWithRole) {
        return res.status(400).json({ msg: `You are already registered as ${backendRole}` });
      }

      // Optional: just log if email exists with another role
      const existingUserOtherRole = await User.findOne({ email: normalizedEmail, role: { $ne: backendRole } });
      if (existingUserOtherRole) {
        console.log(`Note: ${normalizedEmail} is already registered as ${existingUserOtherRole.role}`);
        // We don't block registration, just an informational log
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const otp = generateOTP();
      const otpExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes

      const user = new User({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: backendRole,
        otp,
        otpExpiry,
        isVerified: false,
        loginAttempts: 0,
        lockUntil: null,
      });

      await user.save();

      // Send OTP email
      await sendMailSafe({
        from: `"WriteSpot" <${process.env.EMAIL}>`,
        to: normalizedEmail,
        subject: "WriteSpot - Your Verification Code",
        html: `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0fdf4;">
          <h1 style="color: #16a34a; font-size: 40px;">WriteSpot</h1>
          <h2>Hello ${name}!</h2>
          <p>Your verification code is:</p>
          <h1 style="font-size: 50px; color: #f59e0b; letter-spacing: 10px; margin: 30px 0;">${otp}</h1>
          <p>This code expires in <strong>5 minutes</strong></p>
        </div>
      `,
      });

      res.json({ msg: "Registration successful! Check your email for OTP", email: normalizedEmail });
    } catch (err) {
      console.error("Register error:", err.message);
      res.status(500).json({ msg: "Server Error" });
    }
  },

  // ==================== LOGIN ====================
  login: async (req, res) => {
    try {
      const { email, password, role, rememberMe = false } = req.body;

      if (!email || !password || !role) {
        return res.status(400).json({ msg: "Email, Password and Role required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const expectedRole = role === "reader" ? "reader" : (role === "admin" ? "admin" : "author");

      // Find user with specific email and role
      const user = await User.findOne({ email: normalizedEmail, role: expectedRole });

      if (user && user.lockUntil && user.lockUntil > Date.now()) {
        const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return res.status(423).json({
          msg: `Account locked. Try again in ${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}.`,
        });
      }

      if (!user) {
        await bcrypt.compare("fake", "$2b$10$fakehashfornonexistentuser");
        return res.status(400).json({ msg: "Invalid credentials" });
      }

      if (!user.isVerified) {
        return res.status(400).json({ msg: "Please verify your email first" });
      }

      const isPasswordCorrect = await bcrypt.compare(password, user.password);

      if (!isPasswordCorrect) {
        user.loginAttempts += 1;

        if (user.loginAttempts >= 5) {
          user.lockUntil = Date.now() + 15 * 60 * 1000;
          await user.save();
          return res.status(423).json({ msg: "Too many failed attempts. Account locked for 15 minutes." });
        }

        await user.save();
        return res.status(400).json({ msg: `Invalid credentials. Attempt ${user.loginAttempts} of 5` });
      }

      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      const tokenExpiry = rememberMe ? "7d" : "1h";
      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: tokenExpiry }
      );

      res.json({
        msg: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          preferredGenres: user.preferredGenres || [],
        },
      });
    } catch (err) {
      console.error("Login error:", err.message);
      res.status(500).json({ msg: "Server Error" });
    }
  },

  // ==================== UPDATE PREFERENCES ====================
  updatePreferences: async (req, res) => {
    try {
      const { preferredGenres } = req.body;
      const userId = req.user.id;
      console.log(`DEBUG: Updating preferences for user: ${userId}`, preferredGenres);

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ msg: "User not found" });

      if (preferredGenres) {
        user.preferredGenres = preferredGenres;
      }

      await user.save();

      res.json({
        msg: "Preferences updated",
        preferredGenres: user.preferredGenres
      });
    } catch (err) {
      console.error("Update preferences error:", err);
      res.status(500).json({ msg: "Server Error" });
    }
  },

  // ==================== VERIFY OTP ====================
  verifyOtp: async (req, res) => {
    try {
      const { email, otp, role } = req.body;

      if (!role) {
        return res.status(400).json({ msg: "Role is required" });
      }

      const normalizedEmail = email.toLowerCase();
      const backendRole = role === "reader" ? "reader" : "author";

      // Find user with specific email and role
      const user = await User.findOne({ email: normalizedEmail, role: backendRole });

      if (!user) return res.status(400).json({ msg: "User not found" });

      if (String(user.otp) !== String(otp).trim()) return res.status(400).json({ msg: "Incorrect OTP" });
      if (user.otpExpiry < Date.now()) return res.status(400).json({ msg: "OTP expired" });

      user.isVerified = true;
      user.otp = null;
      user.otpExpiry = null;
      await user.save();

      const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.json({ msg: "Email verified successfully!", token });
    } catch (err) {
      console.error("Verify OTP error:", err);
      res.status(500).json({ msg: "Server Error" });
    }
  },

  // ==================== RESEND OTP ====================
  resendOtp: async (req, res) => {
    try {
      const { email, role } = req.body;

      if (!role) {
        return res.status(400).json({ msg: "Role is required" });
      }

      const normalizedEmail = email.toLowerCase();
      const backendRole = role === "reader" ? "reader" : "author";

      // Find user with specific email and role
      const user = await User.findOne({ email: normalizedEmail, role: backendRole });

      if (!user) return res.status(400).json({ msg: "User not found" });

      const otp = generateOTP();
      user.otp = otp;
      user.otpExpiry = Date.now() + 5 * 60 * 1000; // 5 MINUTES ONLY
      await user.save();

      await sendMailSafe({
        from: `"WriteSpot" <${process.env.EMAIL}>`,
        to: user.email,
        subject: "WriteSpot - New Verification Code",
        html: `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0fdf4;">
            <h1 style="color: #16a34a; font-size: 40px;">WriteSpot</h1>
            <h2>New code requested!</h2>
            <p>Your new verification code is:</p>
            <h1 style="font-size: 50px; color: #f59e0b; letter-spacing: 10px; margin: 30px 0;">${otp}</h1>
            <p>Valid for <strong>5 minutes</strong></p>
          </div>
        `,
      });

      res.json({ msg: "New OTP sent to your email!" });
    } catch (err) {
      console.error("Resend OTP error:", err);
      res.status(500).json({ msg: "Server Error" });
    }
  },

  // ==================== FORGOT PASSWORD ====================
  forgotPassword: async (req, res) => {
    try {
      const { email, role } = req.body;

      if (!email) return res.status(400).json({ msg: "Email is required" });
      if (!role) return res.status(400).json({ msg: "Role is required" });

      const normalizedEmail = email.toLowerCase().trim();
      const backendRole = role === "reader" ? "reader" : "author";

      // Find user with specific email and role
      const user = await User.findOne({ email: normalizedEmail, role: backendRole });

      if (!user) {
        return res.json({ msg: "If your email is registered, you will receive a password reset link." });
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      user.resetToken = resetToken;
      user.resetTokenExpires = Date.now() + 15 * 60 * 1000;
      await user.save();

      const resetLink = `${process.env.API}/reset-password/${resetToken}`;

      await sendMailSafe({
        from: `"WriteSpot" <${process.env.EMAIL}>`,
        to: normalizedEmail,
        subject: "WriteSpot - Reset Your Password",
        html: `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0fdf4;">
            <h1 style="color: #16a34a; font-size: 40px;">WriteSpot</h1>
            <h2>Password Reset Request</h2>
            <p>Click the button below to reset your password:</p>
            <a href="${resetLink}" style="display: inline-block; background: #16a34a; color: white; padding: 16px 36px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 18px; margin: 20px;">
              Reset Password
            </a>
            <p><small>Link expires in 15 minutes</small></p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        `,
      });

      res.json({ msg: "If your email is registered, you will receive a password reset link." });
    } catch (err) {
      console.error("Forgot password error:", err);
      res.status(500).json({ msg: "Server error" });
    }
  },

  // ==================== RESET PASSWORD ====================
  resetPassword: async (req, res) => {
    try {
      const { token } = req.params;
      const { password, confirmPassword } = req.body;

      if (password !== confirmPassword) {
        return res.status(400).json({ msg: "Passwords don't match" });
      }
      if (password.length < 6) {
        return res.status(400).json({ msg: "Password must be at least 6 characters" });
      }

      // Find user by reset token regardless of role
      const user = await User.findOne({
        resetToken: token,
        resetTokenExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res.status(400).json({ msg: "Invalid or expired reset link" });
      }

      user.password = await bcrypt.hash(password, 10);
      user.resetToken = null;
      user.resetTokenExpires = null;
      await user.save();

      res.json({ msg: "Password reset successful! You can now login with your new password." });
    } catch (err) {
      console.error("Reset password error:", err);
      res.status(500).json({ msg: "Server error" });
    }
  },
};