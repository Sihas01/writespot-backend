const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuth");
const verifyPurchase = require("../middleware/verifyPurchase");
const review = require("../controllers/review.controller");

// Create or update review (requires authentication and purchase verification)
router.post(
  "/books/:bookId/reviews",
  auth,
  verifyPurchase,
  review.createOrUpdateReview
);

// Get all reviews for a book (public, with optional sorting)
router.get("/books/:bookId/reviews", optionalAuth, review.getBookReviews);

// Toggle helpful vote (requires authentication)
router.post("/reviews/:reviewId/helpful", auth, review.toggleHelpful);

// Report a review (requires authentication)
router.post("/reviews/:reviewId/report", auth, review.reportReview);

module.exports = router;
