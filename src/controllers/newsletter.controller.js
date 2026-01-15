const mongoose = require("mongoose");
const NewsletterSubscription = require("../models/newsletterSubscription.model");
const AuthorProfile = require("../models/authorProfile.model");
const User = require("../models/user");
const { sendNewBookNotification } = require("../services/emailService");

// Subscribe to author's newsletter
exports.subscribeToAuthor = async (req, res) => {
  try {
    const { authorId } = req.params;
    const subscriberId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    // Check if author profile exists
    const authorProfile = await AuthorProfile.findById(authorId).populate("user", "name email");
    if (!authorProfile) {
      return res.status(404).json({ message: "Author profile not found" });
    }

    // Prevent self-subscription
    if (authorProfile.user._id.toString() === subscriberId) {
      return res.status(400).json({ message: "You cannot subscribe to your own newsletter" });
    }

    // Check if subscription already exists
    const existingSubscription = await NewsletterSubscription.findOne({
      subscriberId,
      authorId,
    });

    if (existingSubscription) {
      if (existingSubscription.isActive) {
        return res.status(400).json({ message: "You are already subscribed to this author" });
      } else {
        // Reactivate subscription
        existingSubscription.isActive = true;
        existingSubscription.unsubscribedAt = null;
        existingSubscription.subscribedAt = new Date();
        // Generate new token for security
        existingSubscription.unsubscribeToken = require("crypto").randomBytes(32).toString("hex");
        await existingSubscription.save();

        return res.json({
          message: "Successfully resubscribed to newsletter",
          subscription: {
            _id: existingSubscription._id,
            authorId: existingSubscription.authorId,
            subscribedAt: existingSubscription.subscribedAt,
          },
        });
      }
    }

    // Create new subscription
    const subscription = await NewsletterSubscription.create({
      subscriberId,
      authorId,
    });

    res.status(201).json({
      message: "Successfully subscribed to newsletter",
      subscription: {
        _id: subscription._id,
        authorId: subscription.authorId,
        subscribedAt: subscription.subscribedAt,
      },
    });
  } catch (error) {
    console.error("Subscribe to author error:", error);
    if (error.code === 11000) {
      return res.status(400).json({ message: "You are already subscribed to this author" });
    }
    res.status(500).json({ message: "Something went wrong while subscribing" });
  }
};

// Unsubscribe from author
exports.unsubscribe = async (req, res) => {
  try {
    const { authorId } = req.params;
    const subscriberId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    const subscription = await NewsletterSubscription.findOne({
      subscriberId,
      authorId,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (!subscription.isActive) {
      return res.status(400).json({ message: "You are already unsubscribed" });
    }

    subscription.isActive = false;
    subscription.unsubscribedAt = new Date();
    await subscription.save();

    res.json({
      message: "Successfully unsubscribed from newsletter",
    });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    res.status(500).json({ message: "Something went wrong while unsubscribing" });
  }
};

// Unsubscribe via email token (public endpoint)
exports.unsubscribeByToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ message: "Unsubscribe token is required" });
    }

    const subscription = await NewsletterSubscription.findOne({
      unsubscribeToken: token,
    }).populate("authorId", "user").populate("subscriberId", "name email");

    if (!subscription) {
      return res.status(404).json({ message: "Invalid unsubscribe token" });
    }

    if (!subscription.isActive) {
      return res.json({
        message: "You are already unsubscribed",
        alreadyUnsubscribed: true,
      });
    }

    subscription.isActive = false;
    subscription.unsubscribedAt = new Date();
    await subscription.save();

    const authorName = subscription.authorId?.user?.name || "the author";

    res.json({
      message: `Successfully unsubscribed from ${authorName}'s newsletter`,
      authorName,
    });
  } catch (error) {
    console.error("Unsubscribe by token error:", error);
    res.status(500).json({ message: "Something went wrong while unsubscribing" });
  }
};

// Get user's subscriptions
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriberId = req.user.id;

    const subscriptions = await NewsletterSubscription.find({
      subscriberId,
      isActive: true,
    })
      .populate({
        path: "authorId",
        populate: {
          path: "user",
          select: "name email",
        },
      })
      .sort({ subscribedAt: -1 });

    const formattedSubscriptions = subscriptions.map((sub) => ({
      _id: sub._id,
      authorId: sub.authorId._id,
      authorName: sub.authorId.user?.name || "Unknown Author",
      authorEmail: sub.authorId.user?.email || "",
      subscribedAt: sub.subscribedAt,
      profileImage: sub.authorId.profileImage || null,
    }));

    res.json({
      subscriptions: formattedSubscriptions,
      count: formattedSubscriptions.length,
    });
  } catch (error) {
    console.error("Get user subscriptions error:", error);
    res.status(500).json({ message: "Something went wrong while fetching subscriptions" });
  }
};

// Send newsletter to subscribers (for future use)
exports.sendNewsletterToSubscribers = async (req, res) => {
  try {
    const { authorId } = req.params;
    const { content } = req.body;
    const authorUserId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    // Verify author owns this profile
    const authorProfile = await AuthorProfile.findById(authorId).populate("user", "name email");
    if (!authorProfile) {
      return res.status(404).json({ message: "Author profile not found" });
    }

    if (authorProfile.user._id.toString() !== authorUserId) {
      return res.status(403).json({ message: "You can only send newsletters from your own profile" });
    }

    // Get all active subscribers
    const subscriptions = await NewsletterSubscription.find({
      authorId,
      isActive: true,
    }).populate("subscriberId", "name email");

    if (subscriptions.length === 0) {
      return res.status(400).json({ message: "No active subscribers found" });
    }

    // Format subscribers for email service
    const subscribers = subscriptions.map((sub) => ({
      unsubscribeToken: sub.unsubscribeToken,
      subscriberEmail: sub.subscriberId?.email || "",
      subscriberName: sub.subscriberId?.name || "Subscriber",
    }));

    // Send emails (this would use sendNewsletterEmail from emailService)
    // For now, return success - implementation can be added later
    res.json({
      message: "Newsletter sending feature coming soon",
      subscriberCount: subscribers.length,
    });
  } catch (error) {
    console.error("Send newsletter error:", error);
    res.status(500).json({ message: "Something went wrong while sending newsletter" });
  }
};
