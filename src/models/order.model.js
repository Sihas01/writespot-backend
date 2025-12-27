const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    quantity: { type: Number, default: 1, min: 1 },
    priceSnapshot: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], default: [] },
    amount: { type: Number, required: true },
    currency: { type: String, default: "LKR" },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "CANCELED"],
      default: "PENDING",
      index: true,
    },
    // PayHere references
    orderId: { type: String, required: true, unique: true, index: true },
    paymentId: { type: String, default: null },
    statusCode: { type: Number, default: null },
    md5sig: { type: String, default: null },
    rawNotification: { type: Object, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);

