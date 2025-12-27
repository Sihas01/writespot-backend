const Cart = require("../models/cart.model");
const Book = require("../models/book.model");
const User = require("../models/user");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET_NAME = "writespot-uploads";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildBookPrice = (book) => {
  const basePrice = Number(book.price) || 0;
  const discountValue = Number(book.discount) || 0;
  const effectivePrice = basePrice - discountValue;
  return effectivePrice >= 0 ? effectivePrice : 0;
};

const fetchCoverUrl = async (book) => {
  if (!book.coverImagePath) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: book.coverImagePath,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const hydrateCart = async (cart) => {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    return { items: [], subtotal: 0, count: 0 };
  }

  const bookIds = cart.items.map((item) => item.book);
  const books = await Book.find({ _id: { $in: bookIds } });
  const bookMap = books.reduce((map, book) => {
    map[book._id.toString()] = book;
    return map;
  }, {});

  const items = await Promise.all(
    cart.items.map(async (item) => {
      const book = bookMap[item.book.toString()];
      if (!book) return null;

      const price = buildBookPrice(book);
      const coverUrl = await fetchCoverUrl(book);
      return {
        bookId: book._id,
        title: book.title,
        author: `${book.author?.firstName || ""} ${book.author?.lastName || ""}`.trim(),
        price,
        quantity: item.quantity || 1,
        coverUrl,
      };
    })
  );

  const filteredItems = items.filter(Boolean);
  const subtotal = filteredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const count = filteredItems.reduce((sum, item) => sum + item.quantity, 0);

  return { items: filteredItems, subtotal, count };
};

const ensureCart = async (userId) => {
  const existing = await Cart.findOne({ user: userId });
  if (existing) return existing;
  return Cart.create({ user: userId, items: [] });
};

const hasPurchasedBook = async (userId, bookId) => {
  const user = await User.findById(userId).select("purchasedBooks");
  if (!user || !Array.isArray(user.purchasedBooks)) return false;
  return user.purchasedBooks.some((ownedId) => ownedId.toString() === bookId);
};

exports.addToCart = async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId) {
      return res.status(400).json({ message: "bookId is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const alreadyPurchased = await hasPurchasedBook(req.user.id, bookId);
    if (alreadyPurchased) {
      return res.status(400).json({ message: "Book already purchased" });
    }

    const cart = await ensureCart(req.user.id);
    const exists = cart.items.some((item) => item.book.toString() === bookId);
    if (exists) {
      return res.status(400).json({ message: "Book already in cart" });
    }

    const priceSnapshot = buildBookPrice(book);
    cart.items.push({ book: book._id, quantity: 1, priceSnapshot });
    await cart.save();

    const payload = await hydrateCart(cart);
    return res.status(200).json({ message: "Book added to cart", cart: payload });
  } catch (error) {
    console.error("Add to cart error:", error);
    return res.status(500).json({ message: "Something went wrong while adding to cart" });
  }
};

exports.getCart = async (req, res) => {
  try {
    const cart = await ensureCart(req.user.id);
    const payload = await hydrateCart(cart);
    return res.json({ message: "Cart fetched", cart: payload });
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json({ message: "Something went wrong while fetching cart" });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!bookId) {
      return res.status(400).json({ message: "bookId is required" });
    }

    const cart = await ensureCart(req.user.id);
    const initialLength = cart.items.length;
    cart.items = cart.items.filter((item) => item.book.toString() !== bookId);

    if (cart.items.length === initialLength) {
      return res.status(404).json({ message: "Book not found in cart" });
    }

    await cart.save();
    const payload = await hydrateCart(cart);
    return res.json({ message: "Book removed from cart", cart: payload });
  } catch (error) {
    console.error("Remove from cart error:", error);
    return res.status(500).json({ message: "Something went wrong while removing from cart" });
  }
};

