const express = require("express");
const authorController = require("../controllers/author.controller");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const optionalAuth = require("../middleware/optionalAuth");

const router = express.Router();

// Profile management
router.post("/profile", auth, role(["author"]), authorController.upsertProfile);
router.get("/profile/:id", optionalAuth, authorController.getPublicProfile);
router.get("/me", auth, role(["author"]), authorController.getMyProfile);

// Engagement
router.post("/:id/follow", auth, authorController.toggleFollow);
router.get("/:id/is-following", auth, authorController.isFollowing);

module.exports = router;

