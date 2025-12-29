const mongoose = require("mongoose");

const socialLinksSchema = new mongoose.Schema(
  {
    twitter: { type: String, trim: true },
    facebook: { type: String, trim: true },
    instagram: { type: String, trim: true },
    linkedin: { type: String, trim: true },
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
    bio: { type: String, trim: true, default: "" },
    profileImageKey: { type: String, trim: true, default: "" },
    profileImageThumbKey: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    socialLinks: { type: socialLinksSchema, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuthorProfile", authorProfileSchema);

