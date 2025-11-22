const router = require("express").Router();
const fakeAuth = require("../middleware/fakeAuth");
const fakeRole = require("../middleware/fakeRole");
const book = require("../controllers/book.controller");
const upload = require("../middleware/upload.middleware");

router.post(
  "/",
  fakeAuth,
  fakeRole("author", "admin"),
  book.addBook
);

// Anyone can read books
router.get("/", book.getAllBooks);

module.exports = router;
