const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuth");
const role = require("../middleware/roleMiddleware");
const book = require("../controllers/book.controller");

router.post(
  "/",
  auth,
  role(["author", "admin"]),
  book.addBook
);

// Anyone can read books (optionally includes ownership flag when authenticated)
router.get("/", optionalAuth, book.getAllBooks);

router.get("/my", auth, role(["author"]), book.getMyBooks);
router.get('/mybooks', auth, book.getAuthorBooks);
router.get("/library", auth, role(["reader"]), book.getMyLibrary);
router.get("/:id/reader", auth, role(["reader"]), book.getBookByIdForReader);
router.get("/:id", optionalAuth, book.getBookById);
router.put("/:id", auth, book.updateBook);
router.delete("/:id", auth, book.deleteBook);

module.exports = router;
