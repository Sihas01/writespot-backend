const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const authorProfileController = require("../controllers/authorProfile.controller");

router.post("/", auth, role(["author"]), authorProfileController.upsertProfile);
router.get("/me", auth, role(["author"]), authorProfileController.getMyProfile);
router.get("/:userId", authorProfileController.getPublicProfile);

module.exports = router;

