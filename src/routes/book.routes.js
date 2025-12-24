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

router.get("/my", auth, role(["author"]), book.getMyBooks);
router.get('/mybooks', auth, book.getAuthorBooks);
router.get("/:id", book.getBookById);
router.put("/:id", auth, book.updateBook);
router.delete("/:id", auth, book.deleteBook);

module.exports = router;
