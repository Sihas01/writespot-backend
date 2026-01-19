const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const likeController = require("../controllers/like.controller");

router.post("/:bookId", auth, likeController.toggleLike);

module.exports = router;
