const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const book = require("../controllers/book.controller");

router.post(
  "/",
  auth,
  role(["author", "admin"]),
  book.addBook
);

// Anyone can read books
router.get("/", book.getAllBooks);

module.exports = router;
