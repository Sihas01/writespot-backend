const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const cart = require("../controllers/cart.controller");

router.post("/items", auth, role(["reader"]), cart.addToCart);
// Alias to support clients posting directly to /cart
router.post("/", auth, role(["reader"]), cart.addToCart);
router.get("/", auth, role(["reader"]), cart.getCart);
router.delete("/items/:bookId", auth, role(["reader"]), cart.removeFromCart);
// Alias to support DELETE /cart/:bookId from clients
router.delete("/:bookId", auth, role(["reader"]), cart.removeFromCart);

module.exports = router;

