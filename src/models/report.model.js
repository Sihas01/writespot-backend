const mongoose = require("mongoose");

// Allowed reasons by target type
const REPORT_REASONS = {
  User: ["Impersonation", "Fake Profile", "Hate Speech", "Spam"],
  Book: [
    "Copyright Violation / Plagiarism",
    "Inappropriate / Offensive Content",
    "Privacy Violation / Doxxing",
    "Encouraging Dangerous or Illegal Acts",
  ],
  Review: ["Harassment", "Spoilers", "Spam", "Hate Speech"],
};

const ReportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetModel: {
      type: String,
      enum: ["User", "Book", "Review"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    details: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "resolved"],
      default: "pending",
    },
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate reports from the same user on the same target
ReportSchema.index({ reporter: 1, targetId: 1 }, { unique: true });

// Index for admin queries - find reports by status or target
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ targetModel: 1, targetId: 1 });

// Validation: ensure reason is valid for the target type
ReportSchema.pre("save", function (next) {
  const allowedReasons = REPORT_REASONS[this.targetModel];
  if (!allowedReasons || !allowedReasons.includes(this.reason)) {
    const error = new Error(
      `Invalid reason "${this.reason}" for target type "${this.targetModel}". Allowed: ${allowedReasons?.join(", ")}`
    );
    error.name = "ValidationError";
    return next(error);
  }
  next();
});

module.exports = mongoose.model("Report", ReportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
