const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ['reader', 'author', 'admin'],
      default: 'reader',
      required: true,
    },
    purchasedBooks: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
      default: [],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    resetToken: {
      type: String,
      default: null
    },
    resetTokenExpires: {
      type: Date,
      default: null
    },
    preferredGenres: {
      type: [String],
      default: []
    },
    readingProgress: [{
      bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book' },
      cfi: String, // Location identifier from Epub.js
      percentage: Number,
      timestamp: { type: Date, default: Date.now }
    }],
    // NEW FIELDS FOR QA REQUIREMENTS
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);