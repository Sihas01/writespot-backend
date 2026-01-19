const Like = require("../models/like.model");
const Book = require("../models/book.model");
const mongoose = require("mongoose");

exports.toggleLike = async (req, res) => {
    try {
        const { bookId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            return res.status(400).json({ message: "Invalid book ID" });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const bookObjectId = new mongoose.Types.ObjectId(bookId);

        const like = await Like.findOne({
            userId: userObjectId,
            bookId: bookObjectId
        });

        console.log(`DEBUG: Toggle Like - User: ${userId}, Book: ${bookId}, Found: ${!!like}`);

        let isLiked = false;
        let likesCount = 0;

        if (like) {
            // Unlike
            await Like.findByIdAndDelete(like._id);
            const book = await Book.findByIdAndUpdate(
                bookObjectId,
                { $inc: { likesCount: -1 } },
                { new: true }
            );
            // Ensure count doesn't go below 0
            if (book.likesCount < 0) {
                book.likesCount = 0;
                await book.save();
            }
            likesCount = book.likesCount;
            isLiked = false;
            console.log(`DEBUG: Unliked. New count: ${likesCount}`);
        } else {
            // Like
            await Like.create({ userId: userObjectId, bookId: bookObjectId });
            const book = await Book.findByIdAndUpdate(
                bookObjectId,
                { $inc: { likesCount: 1 } },
                { new: true }
            );
            likesCount = book.likesCount;
            isLiked = true;
            console.log(`DEBUG: Liked. New count: ${likesCount}`);
        }

        res.json({ success: true, isLiked, likesCount });
    } catch (error) {
        console.error("Toggle like error:", error);
        res.status(500).json({ message: "Failed to toggle like" });
    }
};
