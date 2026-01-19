const mongoose = require("mongoose");

const likeSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        bookId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Book",
            required: true,
        },
    },
    { timestamps: true }
);

// Compound index to ensure a user can only like a book once
likeSchema.index({ userId: 1, bookId: 1 }, { unique: true });

module.exports = mongoose.model("Like", likeSchema);
