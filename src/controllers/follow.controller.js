const mongoose = require("mongoose");
const Follow = require("../models/follow.model");
const User = require("../models/user");

exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user?.id;
    const { id: followingId } = req.params;

    if (!followerId) return res.status(401).json({ msg: "Unauthorized" });
    if (!mongoose.Types.ObjectId.isValid(followingId)) {
      return res.status(400).json({ msg: "Invalid author id" });
    }
    if (followerId === followingId) {
      return res.status(400).json({ msg: "You cannot follow yourself" });
    }

    const targetUser = await User.findById(followingId).select("_id role");
    if (!targetUser) return res.status(404).json({ msg: "Author not found" });

    const existing = await Follow.findOne({ followerId, followingId });
    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
      return res.json({ following: false });
    }

    await Follow.create({ followerId, followingId });
    return res.json({ following: true });
  } catch (err) {
    console.error("toggleFollow error:", err);
    return res.status(500).json({ msg: "Server Error" });
  }
};

exports.isFollowing = async (req, res) => {
  try {
    const followerId = req.user?.id;
    const { id: followingId } = req.params;
    if (!followerId) return res.status(401).json({ msg: "Unauthorized" });
    if (!mongoose.Types.ObjectId.isValid(followingId)) {
      return res.status(400).json({ msg: "Invalid author id" });
    }

    const existing = await Follow.findOne({ followerId, followingId });
    return res.json({ following: Boolean(existing) });
  } catch (err) {
    console.error("isFollowing error:", err);
    return res.status(500).json({ msg: "Server Error" });
  }
};

exports.countFollowers = async (req, res) => {
  try {
    const { id: followingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(followingId)) {
      return res.status(400).json({ msg: "Invalid author id" });
    }
    const count = await Follow.countDocuments({ followingId });
    return res.json({ count });
  } catch (err) {
    console.error("countFollowers error:", err);
    return res.status(500).json({ msg: "Server Error" });
  }
};

