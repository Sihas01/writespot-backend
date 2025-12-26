const crypto = require("crypto");
const Cart = require("../models/cart.model");
const Book = require("../models/book.model");
const Order = require("../models/order.model");
const User = require("../models/user");

const DEFAULT_RETURN_URL = "http://localhost:5173/reader/dashboard/store";
const DEFAULT_CANCEL_URL = "http://localhost:5173/reader/dashboard/store";
const DEFAULT_NOTIFY_URL = "https://api.mysite.com/payhere/notify";
const DEFAULT_FAILURE_URL = "http://localhost:5173/reader/dashboard/store";
const DEFAULT_CURRENCY = "LKR";

const getEnvTrimmed = (key, fallback = "") => {
  const value = process.env[key];
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
};

// Ensure two-decimal string for PayHere hashing/payload
const formatAmount = (amount) => Number(amount || 0).toFixed(2);

const buildBookPrice = (book) => {
  const basePrice = Number(book.price) || 0;
  const discountValue = Number(book.discount) || 0;
  const effectivePrice = basePrice - discountValue;
  return effectivePrice >= 0 ? effectivePrice : 0;
};

const generateOrderId = (userId) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1e6);
  return `ph_${userId}_${timestamp}_${random}`;
};

const generateHash = ({ merchantId, merchantSecret, orderId, amountString, currency }) => {
  // amountString must already be formatted to two decimals
  const secretMd5 = crypto.createHash("md5").update(merchantSecret).digest("hex").toUpperCase();
  const data = `${merchantId}${orderId}${amountString}${currency}${secretMd5}`;
  return crypto.createHash("md5").update(data).digest("hex").toUpperCase();
};

const computePayHereMd5Sig = ({ merchantId, merchantSecret, orderId, payhereAmount, payhereCurrency, statusCode }) => {
  const secretMd5 = crypto.createHash("md5").update(merchantSecret).digest("hex").toUpperCase();
  const data = `${merchantId}${orderId}${payhereAmount}${payhereCurrency}${statusCode}${secretMd5}`;
  return crypto.createHash("md5").update(data).digest("hex").toUpperCase();
};

const upsertPurchasedBooks = async (userId, items) => {
  const user = await User.findById(userId).select("purchasedBooks");
  if (!user) return;

  const existing = new Set((user.purchasedBooks || []).map((id) => id.toString()));
  items.forEach((item) => existing.add(item.bookId.toString()));
  user.purchasedBooks = Array.from(existing);
  await user.save();
};

const clearCart = async (userId) => {
  const cart = await Cart.findOne({ user: userId });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
};

exports.createOrderAndHash = async (req, res) => {
  try {
    const merchantId = getEnvTrimmed("PAYHERE_MERCHANT_ID");
    const merchantSecret = getEnvTrimmed("PAYHERE_MERCHANT_SECRET");

    if (!merchantId || !merchantSecret) {
      return res.status(500).json({ message: "Payment configuration missing" });
    }

    const user = await User.findById(req.user.id).select("name email isVerified");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const bookIds = cart.items.map((item) => item.book);
    const books = await Book.find({ _id: { $in: bookIds } });
    const bookMap = books.reduce((map, book) => {
      map[book._id.toString()] = book;
      return map;
    }, {});

    const items = cart.items
      .map((item) => {
        const book = bookMap[item.book.toString()];
        if (!book) return null;
        const price = Number(item.priceSnapshot || buildBookPrice(book));
        const quantity = item.quantity || 1;
        return {
          bookId: book._id,
          quantity,
          priceSnapshot: price,
          title: book.title,
        };
      })
      .filter(Boolean);

    if (items.length === 0) {
      return res.status(400).json({ message: "Cart items invalid" });
    }

    const amount = items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    const amountString = formatAmount(amount);
    const currency = DEFAULT_CURRENCY;
    const orderId = generateOrderId(req.user.id);

    await Order.create({
      user: req.user.id,
      items: items.map(({ bookId, quantity, priceSnapshot }) => ({ bookId, quantity, priceSnapshot })),
      amount,
      currency,
      status: "PENDING",
      orderId,
    });

    const hash = generateHash({ merchantId, merchantSecret, orderId, amountString, currency });

    const itemsLabel =
      items.length === 1 ? items[0].title : `Book purchase (${items.length} items)`;

    const [firstName, ...rest] = (user.name || "").trim().split(" ");
    const lastName = rest.join(" ");

    console.info("PayHere checkout payload", {
      orderId,
      amount: amountString,
      currency,
      merchantId,
      returnUrl: getEnvTrimmed("PAYHERE_RETURN_URL", DEFAULT_RETURN_URL),
      cancelUrl: getEnvTrimmed("PAYHERE_CANCEL_URL", DEFAULT_CANCEL_URL),
      notifyUrl: getEnvTrimmed("PAYHERE_NOTIFY_URL", DEFAULT_NOTIFY_URL),
      hash,
    });

    return res.status(200).json({
      message: "Order created",
      payhereParams: {
        sandbox: true,
        merchant_id: merchantId,
        return_url: getEnvTrimmed("PAYHERE_RETURN_URL", DEFAULT_RETURN_URL),
        cancel_url: getEnvTrimmed("PAYHERE_CANCEL_URL", DEFAULT_CANCEL_URL),
        notify_url: getEnvTrimmed("PAYHERE_NOTIFY_URL", DEFAULT_NOTIFY_URL),
        order_id: orderId,
        items: itemsLabel,
        amount: amountString,
        currency,
        hash,
        first_name: firstName || user.name || "Reader",
        last_name: lastName || "User",
        email: (user.email || "").trim().toLowerCase(),
        phone: "0000000000",
        address: "N/A",
        city: "Colombo",
        country: "Sri Lanka",
      },
      order: { orderId, amount: formatAmount(amount), currency, status: "PENDING" },
    });
  } catch (error) {
    console.error("createOrderAndHash error:", error);
    return res.status(500).json({ message: "Failed to create order" });
  }
};

exports.getOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findOne({ orderId, user: req.user.id });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json({
      message: "Order fetched",
      order: {
        orderId: order.orderId,
        status: order.status,
        amount: formatAmount(order.amount),
        currency: order.currency,
      },
    });
  } catch (error) {
    console.error("getOrderStatus error:", error);
    return res.status(500).json({ message: "Failed to fetch order" });
  }
};

exports.notify = async (req, res) => {
  try {
    const merchantId = getEnvTrimmed("PAYHERE_MERCHANT_ID");
    const merchantSecret = getEnvTrimmed("PAYHERE_MERCHANT_SECRET");

    if (!merchantId || !merchantSecret) {
      return res.status(500).json({ message: "Payment configuration missing" });
    }

    const {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      custom_1,
      custom_2,
      status_message,
      method,
    } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ message: "order_id missing" });
    }

    const order = await Order.findOne({ orderId: order_id });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const expectedSig = computePayHereMd5Sig({
      merchantId,
      merchantSecret,
      orderId: order_id,
      payhereAmount: payhere_amount,
      payhereCurrency: payhere_currency,
      statusCode: status_code,
    });

    if (expectedSig !== md5sig) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    const statusCodeNum = Number(status_code);
    const statusMap = {
      2: "COMPLETED",
      0: "PENDING",
      "-1": "CANCELED",
      "-2": "FAILED",
      "-3": "FAILED",
    };

    const newStatus = statusMap[status_code] || "FAILED";

    // Idempotency: if already completed, just return success
    if (order.status === "COMPLETED") {
      return res.json({ message: "Already completed" });
    }

    order.paymentId = payment_id || order.paymentId;
    order.statusCode = statusCodeNum;
    order.md5sig = md5sig;
    order.rawNotification = {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      custom_1,
      custom_2,
      status_message,
      method,
    };
    order.status = newStatus;
    await order.save();

    if (newStatus === "COMPLETED") {
      await upsertPurchasedBooks(order.user, order.items);
      await clearCart(order.user);
      return res.json({ message: "Payment completed" });
    }

    return res.json({ message: `Payment ${newStatus.toLowerCase()}` });
  } catch (error) {
    console.error("notify error:", error);
    return res.status(500).json({ message: "Failed to process notification" });
  }
};

exports.getFailureRedirect = (req, res) => {
  return res.redirect(getEnvTrimmed("PAYHERE_FAILURE_URL", DEFAULT_FAILURE_URL));
};

