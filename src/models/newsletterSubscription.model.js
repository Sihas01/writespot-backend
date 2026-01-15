const mongoose = require("mongoose");
const crypto = require("crypto");

const newsletterSubscriptionSchema = new mongoose.Schema({
  subscriberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AuthorProfile",
    required: true,
    index: true,
  },
  unsubscribeToken: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: function() {
      return crypto.randomBytes(32).toString('hex');
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  subscribedAt: {
    type: Date,
    default: Date.now,
  },
  unsubscribedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Unique compound index to prevent duplicate subscriptions
newsletterSubscriptionSchema.index({ subscriberId: 1, authorId: 1 }, { unique: true });

module.exports = mongoose.model("NewsletterSubscription", newsletterSubscriptionSchema);
