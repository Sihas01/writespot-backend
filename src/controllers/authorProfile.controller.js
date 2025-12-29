const mongoose = require("mongoose");
const AuthorProfile = require("../models/authorProfile.model");
const User = require("../models/user");
const Book = require("../models/book.model");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET_NAME = "writespot-uploads";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildCoverUrl = async (book) => {
  if (!book?.coverImagePath) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: book.coverImagePath,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const buildProfileImageUrl = async (keyOrUrl) => {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) {
    return keyOrUrl;
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: keyOrUrl,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const resolveProfileImages = async (profileDoc) => {
  if (!profileDoc) return { profileImageUrlResolved: "", profileImageThumbUrlResolved: "" };
  const [profileImageUrlResolved, profileImageThumbUrlResolved] = await Promise.all([
    buildProfileImageUrl(profileDoc.profileImageKey),
    buildProfileImageUrl(profileDoc.profileImageThumbKey),
  ]);
  return { profileImageUrlResolved, profileImageThumbUrlResolved };
};

const formatProfile = (user, profileDocWithUrls) => {
  if (!user) return null;
  const profileImageKey = profileDocWithUrls?.profileImageKey || "";
  const profileImageThumbKey = profileDocWithUrls?.profileImageThumbKey || "";

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    bio: profileDocWithUrls?.bio || "",
    profileImageKey,
    profileImageThumbKey,
    profileImageUrl: profileDocWithUrls?.profileImageThumbUrlResolved || profileDocWithUrls?.profileImageUrlResolved || "",
    profileImageMainUrl: profileDocWithUrls?.profileImageUrlResolved || "",
    profileImageThumbUrl: profileDocWithUrls?.profileImageThumbUrlResolved || "",
    website: profileDocWithUrls?.website || "",
    socialLinks: profileDocWithUrls?.socialLinks || {},
  };
};

exports.upsertProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ msg: "Unauthorized" });
    }

    const user = await User.findById(userId).select("role isVerified name email");
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }
    if (user.role !== "author") {
      return res.status(403).json({ msg: "Only authors can update profile" });
    }
    if (!user.isVerified) {
      return res.status(400).json({ msg: "Please verify your email first" });
    }

    const { bio, profileImageKey, profileImageThumbKey, profileImageUrl, website, socialLinks = {} } = req.body || {};

    const payload = {
      bio: bio?.trim?.() || "",
      profileImageKey: (profileImageKey || profileImageUrl || "").trim(),
      profileImageThumbKey: (profileImageThumbKey || "").trim(),
      website: website?.trim?.() || "",
      socialLinks: {
        twitter: socialLinks.twitter?.trim?.(),
        facebook: socialLinks.facebook?.trim?.(),
        instagram: socialLinks.instagram?.trim?.(),
        linkedin: socialLinks.linkedin?.trim?.(),
      },
    };

    const profile = await AuthorProfile.findOneAndUpdate(
      { user: userId },
      payload,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const { profileImageUrlResolved, profileImageThumbUrlResolved } = await resolveProfileImages(profile);
    const profileWithUrl = {
      ...profile.toObject(),
      profileImageUrlResolved,
      profileImageThumbUrlResolved,
    };

    return res.json({ msg: "Profile saved", profile: formatProfile(user, profileWithUrl) });
  } catch (error) {
    console.error("Upsert author profile error:", error);
    return res.status(500).json({ msg: "Server Error" });
  }
};

exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ msg: "Unauthorized" });
    }

    const user = await User.findById(userId).select("name email role");
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const profile = await AuthorProfile.findOne({ user: userId });
    const { profileImageUrlResolved, profileImageThumbUrlResolved } = await resolveProfileImages(profile);
    const profileWithUrl = profile
      ? { ...profile.toObject(), profileImageUrlResolved, profileImageThumbUrlResolved }
      : null;

    return res.json({ profile: formatProfile(user, profileWithUrl) });
  } catch (error) {
    console.error("Get my profile error:", error);
    return res.status(500).json({ msg: "Server Error" });
  }
};

exports.getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ msg: "Invalid author id" });
    }

    const [user, profileDoc, books] = await Promise.all([
      User.findById(userId).select("name email role"),
      AuthorProfile.findOne({ user: userId }),
      Book.find({ createdBy: userId }),
    ]);

    if (!user) {
      return res.status(404).json({ msg: "Author not found" });
    }

    const booksWithCover = await Promise.all(
      (books || []).map(async (book) => ({
        ...book.toObject(),
        coverUrl: await buildCoverUrl(book),
      }))
    );

    const { profileImageUrlResolved, profileImageThumbUrlResolved } = await resolveProfileImages(profileDoc);
    const profileWithUrl = profileDoc
      ? { ...profileDoc.toObject(), profileImageUrlResolved, profileImageThumbUrlResolved }
      : null;

    return res.json({
      profile: formatProfile(user, profileWithUrl),
      books: booksWithCover,
    });
  } catch (error) {
    console.error("Get public author profile error:", error);
    return res.status(500).json({ msg: "Server Error" });
  }
};

