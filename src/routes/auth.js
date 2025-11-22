const express = require('express');
const router = express.Router();
const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const config = require('../config/config');

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.EMAIL,
    pass: config.EMAIL_PASS,
  },
});

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==================== REGISTER ====================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, confirmPassword, role } = req.body;

    if (!name || !email || !password || !confirmPassword || !role) {
      return res.status(400).json({ msg: 'All fields are required' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ msg: 'Passwords do not match' });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000;

    // Convert "Reader"/"Author" → "student"/"teacher"
    const backendRole = role === "Reader" ? "student" : "teacher";

    user = new User({
      name,
      email,
      password: hashedPassword,
      role: backendRole,
      otp,
      otpExpiry,
      isVerified: false,
    });

    await user.save();

    // Send OTP Email
    try {
      await transporter.sendMail({
        from: `"WriteSpot" <${config.EMAIL}>`,
        to: email,
        subject: 'WriteSpot - Your Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0fdf4;">
            <h1 style="color: #16a34a; font-size: 40px;">WriteSpot</h1>
            <h2>Hello ${name}!</h2>
            <p>Your verification code is:</p>
            <h1 style="font-size: 50px; color: #f59e0b; letter-spacing: 10px; margin: 30px 0;">${otp}</h1>
            <p>This code expires in <strong>10 minutes</strong></p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Email failed:', emailErr.message);
    }

    res.json({ msg: 'OTP sent! Check your email', email });

  } catch (err) {  // ← THIS WAS MISSING BEFORE
    console.error('Register error:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// ==================== LOGIN ====================
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ msg: 'Email, Password and Role required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });
    if (!user.isVerified) return res.status(400).json({ msg: 'Please verify your email first' });

    const expectedRole = role === "Reader" ? "student" : "teacher";
    if (user.role !== expectedRole) {
      return res.status(400).json({ msg: 'Invalid role selected' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      config.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      msg: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// ==================== VERIFY OTP ====================
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'User not found' });

    if (String(user.otp) !== String(otp).trim()) {
      return res.status(400).json({ msg: 'Incorrect OTP' });
    }
    if (user.otpExpiry < Date.now()) {
      return res.status(400).json({ msg: 'OTP expired' });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const token = jwt.sign({ id: user._id }, config.JWT_SECRET, { expiresIn: '7d' });

    res.json({ msg: 'Email verified successfully!', token });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;