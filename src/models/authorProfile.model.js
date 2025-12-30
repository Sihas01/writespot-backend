const mongoose = require("mongoose");

const socialSchema = new mongoose.Schema(
  {
    twitter: { type: String, default: "" },
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
  },
  { _id: false }
);

const authorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    bio: { type: String, default: "" },
    profileImage: { type: String, default: "" }, // S3 key
    socialLinks: { type: socialSchema, default: () => ({}) },
    newsletterUrl: { type: String, default: "" },
    followersCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuthorProfile", authorProfileSchema);

