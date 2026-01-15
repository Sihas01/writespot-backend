const mongoose = require("mongoose");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const AuthorProfile = require("../models/authorProfile.model");
const Follow = require("../models/follow.model");
const NewsletterSubscription = require("../models/newsletterSubscription.model");
const User = require("../models/user");
const Book = require("../models/book.model");

const BUCKET_NAME = "writespot-uploads";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildProfileImageUrl = async (profile) => {
  if (!profile?.profileImage) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: profile.profileImage,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const buildCoverUrl = async (book) => {
  if (!book?.coverImagePath) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: book.coverImagePath,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const normalizeSocials = (socialLinks = {}) => ({
  twitter: socialLinks.twitter?.trim() || "",
  facebook: socialLinks.facebook?.trim() || "",
  instagram: socialLinks.instagram?.trim() || "",
});

const ensureVerifiedAuthor = async (userId) => {
  const user = await User.findById(userId).select("role isVerified");
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  if (user.role !== "author") {
    const err = new Error("Only authors can manage profiles");
    err.status = 403;
    throw err;
  }
  if (!user.isVerified) {
    const err = new Error("Account not verified");
    err.status = 403;
    throw err;
  }
  return user;
};

const ensureVerifiedUser = async (userId) => {
  const user = await User.findById(userId).select("isVerified");
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  if (!user.isVerified) {
    const err = new Error("Account not verified");
    err.status = 403;
    throw err;
  }
  return user;
};

module.exports = {
  upsertProfile: async (req, res) => {
    try {
      await ensureVerifiedAuthor(req.user.id);

      const { bio = "", profileImage = "", socialLinks = {}, newsletterUrl = "" } = req.body;
      const normalizedSocials = normalizeSocials(socialLinks);

      const profile = await AuthorProfile.findOneAndUpdate(
        { user: req.user.id },
        {
          $set: {
            bio,
            profileImage,
            socialLinks: normalizedSocials,
            newsletterUrl: newsletterUrl?.trim() || "",
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      const profileImageUrl = await buildProfileImageUrl(profile);

      res.json({
        msg: "Profile saved",
        profile: {
          id: profile._id,
          bio: profile.bio,
          profileImage: profile.profileImage,
          profileImageUrl,
          socialLinks: profile.socialLinks,
          newsletterUrl: profile.newsletterUrl,
          followersCount: profile.followersCount,
          user: profile.user,
        },
        hasProfile: true,
      });
    } catch (err) {
      console.error("Upsert author profile error:", err);
      res
        .status(err.status || 500)
        .json({ msg: err.message || "Failed to save profile" });
    }
  },

  getMyProfile: async (req, res) => {
    try {
      await ensureVerifiedAuthor(req.user.id);

      const profile = await AuthorProfile.findOne({ user: req.user.id });
      if (!profile) {
        return res.json({ hasProfile: false });
      }

      const profileImageUrl = await buildProfileImageUrl(profile);

      res.json({
        hasProfile: true,
        profile: {
          id: profile._id,
          bio: profile.bio,
          profileImage: profile.profileImage,
          profileImageUrl,
          socialLinks: profile.socialLinks,
          newsletterUrl: profile.newsletterUrl,
          followersCount: profile.followersCount,
        },
      });
    } catch (err) {
      console.error("Get my profile error:", err);
      res
        .status(err.status || 500)
        .json({ msg: err.message || "Failed to fetch profile" });
    }
  },

  getPublicProfile: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ msg: "Invalid profile id" });
      }

      const profile = await AuthorProfile.findById(id).populate("user", "name role email");
      if (!profile) {
        return res.status(404).json({ msg: "Author profile not found" });
      }

      const [profileImageUrl, books, isFollowing, isSubscribed, subscribersCount] = await Promise.all([
        buildProfileImageUrl(profile),
        Book.find({ createdBy: profile.user }).lean(),
        req.user?.id
          ? Follow.exists({ followerId: req.user.id, followingId: id })
          : null,
        req.user?.id
          ? NewsletterSubscription.exists({
              subscriberId: req.user.id,
              authorId: id,
              isActive: true,
            })
          : null,
        NewsletterSubscription.countDocuments({
          authorId: id,
          isActive: true,
        }),
      ]);

      const booksWithCovers = await Promise.all(
        (books || []).map(async (book) => ({
          ...book,
          coverUrl: await buildCoverUrl(book),
        }))
      );

      res.json({
        profile: {
          id: profile._id,
          user: {
            id: profile.user._id,
            name: profile.user.name,
            role: profile.user.role,
            email: profile.user.email,
          },
          bio: profile.bio,
          profileImage: profile.profileImage,
          profileImageUrl,
          socialLinks: profile.socialLinks,
          newsletterUrl: profile.newsletterUrl,
          followersCount: profile.followersCount,
        },
        books: booksWithCovers,
        isFollowing: Boolean(isFollowing),
        isSubscribed: Boolean(isSubscribed),
        subscribersCount: subscribersCount || 0,
      });
    } catch (err) {
      console.error("Get public profile error:", err);
      res.status(500).json({ msg: "Failed to fetch profile" });
    }
  },

  toggleFollow: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ msg: "Invalid profile id" });
      }

      await ensureVerifiedUser(req.user.id);
      const profile = await AuthorProfile.findById(id);
      if (!profile) {
        return res.status(404).json({ msg: "Author profile not found" });
      }

      if (String(profile.user) === String(req.user.id)) {
        return res.status(400).json({ msg: "You cannot follow yourself" });
      }

      const existing = await Follow.findOne({
        followerId: req.user.id,
        followingId: id,
      });

      let isFollowing;
      if (existing) {
        await Follow.deleteOne({ _id: existing._id });
        const updated = await AuthorProfile.findByIdAndUpdate(
          id,
          { $inc: { followersCount: -1 } },
          { new: true }
        );
        if (updated.followersCount < 0) {
          updated.followersCount = 0;
          await updated.save();
        }
        isFollowing = false;
        return res.json({
          msg: "Unfollowed",
          isFollowing,
          followersCount: updated.followersCount,
        });
      }

      await Follow.create({
        followerId: req.user.id,
        followingId: id,
      });
      const updated = await AuthorProfile.findByIdAndUpdate(
        id,
        { $inc: { followersCount: 1 } },
        { new: true }
      );
      isFollowing = true;

      res.json({
        msg: "Followed",
        isFollowing,
        followersCount: updated.followersCount,
      });
    } catch (err) {
      console.error("Toggle follow error:", err);
      if (err.code === 11000) {
        return res.status(409).json({ msg: "Already following" });
      }
      res.status(500).json({ msg: "Failed to update follow status" });
    }
  },

  isFollowing: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ msg: "Invalid profile id" });
      }

      await ensureVerifiedUser(req.user.id);
      const exists = await Follow.exists({
        followerId: req.user.id,
        followingId: id,
      });

      res.json({ isFollowing: Boolean(exists) });
    } catch (err) {
      console.error("Is following error:", err);
      res.status(500).json({ msg: "Failed to check follow status" });
    }
  },
};

