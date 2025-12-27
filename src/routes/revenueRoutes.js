const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const revenue = require("../controllers/revenueController");

router.get("/summary", auth, role(["author"]), revenue.getSummary);
router.get("/by-book", auth, role(["author"]), revenue.getByBook);
router.get("/history", auth, role(["author"]), revenue.getHistory);
router.post("/withdraw", auth, role(["author"]), revenue.postWithdraw);

module.exports = router;

