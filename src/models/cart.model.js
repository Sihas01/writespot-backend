const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    quantity: { type: Number, default: 1, min: 1 },
    priceSnapshot: { type: Number, default: 0 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

cartSchema.index({ user: 1, "items.book": 1 });

module.exports = mongoose.model("Cart", cartSchema);

