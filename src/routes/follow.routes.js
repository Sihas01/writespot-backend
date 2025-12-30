const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const followController = require("../controllers/follow.controller");

// with /api prefix
router.post("/api/authors/:id/follow", auth, followController.toggleFollow);
router.get("/api/authors/:id/is-following", auth, followController.isFollowing);
router.get("/api/authors/:id/followers-count", followController.countFollowers);

// without /api prefix (for consistency with other non-api routes)
router.post("/authors/:id/follow", auth, followController.toggleFollow);
router.get("/authors/:id/is-following", auth, followController.isFollowing);
router.get("/authors/:id/followers-count", followController.countFollowers);

module.exports = router;

