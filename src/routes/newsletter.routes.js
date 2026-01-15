const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const newsletter = require("../controllers/newsletter.controller");

// Subscribe to author's newsletter (requires authentication, reader role)
router.post(
  "/subscribe/:authorId",
  auth,
  role(["reader"]),
  newsletter.subscribeToAuthor
);

// Unsubscribe from author (requires authentication)
router.post(
  "/unsubscribe/:authorId",
  auth,
  newsletter.unsubscribe
);

// Unsubscribe via email token (public endpoint, no auth required)
router.get(
  "/unsubscribe/:token",
  newsletter.unsubscribeByToken
);

// Get user's subscriptions (requires authentication)
router.get(
  "/subscriptions",
  auth,
  newsletter.getUserSubscriptions
);

// Send newsletter to subscribers (requires authentication, author role, future feature)
router.post(
  "/send/:authorId",
  auth,
  role(["author"]),
  newsletter.sendNewsletterToSubscribers
);

module.exports = router;
