const mongoose = require("mongoose");
const Review = require("../models/reviewV2.model"); // Switch to V2
const Book = require("../models/book.model");
const User = require("../models/user");
const Order = require("../models/order.model");

const getOwnedBookIds = async (userId) => {
  const [orders, user] = await Promise.all([
    Order.find({ user: userId, status: "COMPLETED" }).select("items"),
    User.findById(userId).select("purchasedBooks"),
  ]);

  const owned = new Set();

  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.bookId) owned.add(item.bookId.toString());
    });
  });

  if (user && Array.isArray(user.purchasedBooks)) {
    user.purchasedBooks.forEach((bookId) => owned.add(bookId.toString()));
  }

  return Array.from(owned);
};

const calculateBookRating = async (bookId) => {
  const reviews = await Review.find({ bookId });
  if (reviews.length === 0) {
    return { averageRating: 0, reviewCount: 0 };
  }

  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = Math.round((totalRating / reviews.length) * 10) / 10; // Round to 1 decimal place

  return { averageRating, reviewCount: reviews.length };
};

const updateBookRating = async (bookId) => {
  const { averageRating, reviewCount } = await calculateBookRating(bookId);
  await Book.findByIdAndUpdate(bookId, {
    rating: averageRating,
  });
  return { averageRating, reviewCount };
};

// Create or update review
exports.createOrUpdateReview = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { rating, reviewText } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    // Verify purchase
    const ownedBookIds = await getOwnedBookIds(userId);
    if (!ownedBookIds.includes(bookId.toString())) {
      return res.status(403).json({ message: "Only purchasers can review" });
    }

    // Check if book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // Use findOneAndUpdate with upsert in the NEW collection (V2)
    // This is a fresh collection, so no index corruption issues should exist.
    const review = await Review.findOneAndUpdate(
      {
        bookId: new mongoose.Types.ObjectId(bookId),
        userId: new mongoose.Types.ObjectId(userId)
      },
      {
        rating,
        reviewText: reviewText || null
      },
      {
        new: true, // Return the modified document
        upsert: true, // Create if doesn't exist
        setDefaultsOnInsert: true,
        runValidators: true
      }
    );

    // Update book rating
    const { averageRating, reviewCount } = await updateBookRating(bookId);

    // Populate user info for response
    await review.populate("userId", "name email");

    res.status(200).json({
      message: "Review saved successfully",
      review: {
        _id: review._id,
        bookId: review.bookId,
        userId: review.userId._id,
        reviewerName: review.userId.name,
        rating: review.rating,
        reviewText: review.reviewText,
        helpfulVotes: review.helpfulVotes || [],
        helpfulCount: (review.helpfulVotes || []).length,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      },
      bookRating: {
        averageRating,
        reviewCount,
      },
    });
  } catch (error) {
    console.error("Create/update review error:", error);
    res.status(500).json({ message: "Something went wrong while saving the review" });
  }
};

// Get book reviews with sorting
exports.getBookReviews = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { sort = "newest" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    // Check if book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    let reviews;

    // Apply sorting
    switch (sort.toLowerCase()) {
      case "most_helpful":
      case "helpful":
        // Sort by helpful votes count descending
        reviews = await Review.find({ bookId })
          .populate("userId", "name email")
          .lean();
        reviews = reviews.sort((a, b) => {
          const aHelpful = (a.helpfulVotes || []).length;
          const bHelpful = (b.helpfulVotes || []).length;
          return bHelpful - aHelpful;
        });
        break;
      case "highest_rating":
      case "highest":
        reviews = await Review.find({ bookId })
          .populate("userId", "name email")
          .sort({ rating: -1, createdAt: -1 })
          .lean();
        break;
      case "newest":
      default:
        reviews = await Review.find({ bookId })
          .populate("userId", "name email")
          .sort({ createdAt: -1 })
          .lean();
        break;
    }

    // Format reviews for response
    // Get current user ID if authenticated
    const currentUserId = req.user?.id ? req.user.id.toString() : null;

    const formattedReviews = Array.isArray(reviews)
      ? reviews.map((review) => {
        const helpfulVotes = review.helpfulVotes || [];
        const hasVoted = currentUserId
          ? helpfulVotes.some((id) => id.toString() === currentUserId)
          : false;

        return {
          _id: review._id,
          bookId: review.bookId,
          userId: review.userId?._id || review.userId,
          reviewerName: review.userId?.name || "Anonymous",
          rating: review.rating,
          reviewText: review.reviewText,
          helpfulVotes: helpfulVotes,
          helpfulCount: helpfulVotes.length,
          hasVoted,
          createdAt: review.createdAt,
          updatedAt: review.updatedAt,
        };
      })
      : [];

    // Don't show flagged reviews to regular users
    const filteredReviews = formattedReviews.filter((review) => {
      // Only filter if user is not admin (could add admin check later)
      return true; // For now, show all reviews
    });

    res.json({
      reviews: filteredReviews,
      total: filteredReviews.length,
    });
  } catch (error) {
    console.error("Get book reviews error:", error);
    res.status(500).json({ message: "Something went wrong while fetching reviews" });
  }
};

// Toggle helpful vote
exports.toggleHelpful = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Prevent self-voting
    if (review.userId.toString() === userId) {
      return res.status(400).json({ message: "You cannot vote on your own review" });
    }

    const helpfulVotes = review.helpfulVotes || [];
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const hasVoted = helpfulVotes.some(
      (id) => id.toString() === userId.toString()
    );

    if (hasVoted) {
      // Remove vote
      review.helpfulVotes = helpfulVotes.filter(
        (id) => id.toString() !== userId.toString()
      );
    } else {
      // Add vote
      review.helpfulVotes.push(userObjectId);
    }

    await review.save();

    res.json({
      message: hasVoted ? "Vote removed" : "Marked as helpful",
      helpfulCount: review.helpfulVotes.length,
      hasVoted: !hasVoted,
    });
  } catch (error) {
    console.error("Toggle helpful error:", error);
    res.status(500).json({ message: "Something went wrong while updating helpful vote" });
  }
};

// Report a review
exports.reportReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Prevent self-reporting
    if (review.userId.toString() === userId) {
      return res.status(400).json({ message: "You cannot report your own review" });
    }

    const reportedBy = review.reportedBy || [];
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const alreadyReported = reportedBy.some(
      (id) => id.toString() === userId.toString()
    );

    if (alreadyReported) {
      return res.status(400).json({ message: "You have already reported this review" });
    }

    // Add report
    review.reportedBy.push(userObjectId);

    const reportCount = review.reportedBy.length;

    // Check for auto-deletion threshold (10 reports)
    if (reportCount >= 10) {
      const bookId = review.bookId;
      await Review.findByIdAndDelete(review._id);

      // Recalculate book rating after deletion
      const { averageRating, reviewCount } = await updateBookRating(bookId);

      return res.json({
        message: "Review automatically deleted due to high report volume",
        deleted: true,
        bookRating: { averageRating, reviewCount }
      });
    }

    // Flag if threshold reached (3+ reports)
    if (reportCount >= 3) {
      review.isFlagged = true;
    }

    await review.save();

    res.json({
      message: "Review reported successfully",
      isFlagged: review.isFlagged,
      reportCount: reportCount,
    });
  } catch (error) {
    console.error("Report review error:", error);
    res.status(500).json({ message: "Something went wrong while reporting the review" });
  }
};
