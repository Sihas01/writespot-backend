const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Book",
        required: true,
        index: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    reviewText: {
        type: String,
        default: null,
    },
    helpfulVotes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    reportedBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    isFlagged: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
});

// Unique compound index to enforce one review per user per book
reviewSchema.index({ bookId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("ReviewV2", reviewSchema);
