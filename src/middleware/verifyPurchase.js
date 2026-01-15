const Order = require("../models/order.model");
const User = require("../models/user");

const getOwnedBookIds = async (userId) => {
  const [orders, user] = await Promise.all([
    Order.find({ user: userId, status: "COMPLETED" }).select("items"),
    User.findById(userId).select("purchasedBooks"),
  ]);

  const owned = new Set();

  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.bookId) owned.add(item.bookId.toString());
    });
  });

  if (user && Array.isArray(user.purchasedBooks)) {
    user.purchasedBooks.forEach((bookId) => owned.add(bookId.toString()));
  }

  return Array.from(owned);
};

module.exports = async (req, res, next) => {
  try {
    const { bookId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!bookId) {
      return res.status(400).json({ message: "Book ID is required" });
    }

    const ownedBookIds = await getOwnedBookIds(userId);
    const ownsBook = ownedBookIds.includes(bookId.toString());

    if (!ownsBook) {
      return res.status(403).json({ message: "Only purchasers can review" });
    }

    next();
  } catch (error) {
    console.error("Purchase verification error:", error);
    res.status(500).json({ message: "Error verifying purchase" });
  }
};
