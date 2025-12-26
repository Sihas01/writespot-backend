const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    relatedBookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", default: null, index: true },
    amount: { type: Number, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    type: { type: String, enum: ["CREDIT", "DEBIT"], required: true, index: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["PENDING", "COMPLETED"], default: "COMPLETED", index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);

