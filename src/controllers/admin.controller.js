const User = require("../models/user");
const Book = require("../models/book.model");
const Transaction = require("../models/transaction.model");

exports.getDashboardStats = async (req, res) => {
    try {
        const [userCount, authorCount, bookCount, totalRevenue] = await Promise.all([
            User.countDocuments({ role: "reader" }),
            User.countDocuments({ role: "author" }),
            Book.countDocuments(),
            Transaction.aggregate([
                { $match: { type: "CREDIT", status: "COMPLETED" } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$amount" },
                    },
                },
            ]),
        ]);

        res.json({
            users: userCount,
            authors: authorCount,
            books: bookCount,
            revenue: totalRevenue[0]?.total || 0,
        });
    } catch (error) {
        console.error("getDashboardStats error:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const role = req.query.role; // Optional role filter

        const query = {};
        if (role) query.role = role;

        const [users, total] = await Promise.all([
            User.find(query).select("-password -otp -resetToken").skip(skip).limit(limit).sort({ createdAt: -1 }),
            User.countDocuments(query),
        ]);

        res.json({
            data: users,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("getAllUsers error:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) return res.status(404).json({ message: "User not found" });

        // Prevent deleting self or other admins
        if (user.role === "admin") {
            return res.status(403).json({ message: "Cannot delete admin users" });
        }

        await User.findByIdAndDelete(id);
        // Optionally: Cascade delete books, transactions, etc.
        // For now, we will keep it simple.

        res.json({ message: "User deleted successfully" });
    } catch (error) {
        console.error("deleteUser error:", error);
        res.status(500).json({ message: "Failed to delete user" });
    }
};

exports.getAllBooks = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        console.log("Admin getAllBooks Query:", { page, limit, skip });
        const [books, total] = await Promise.all([
            Book.find()
                .populate("createdBy", "name email")
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 }),
            Book.countDocuments(),
        ]);
        console.log("Admin getAllBooks found:", books.length, "Total:", total);

        res.json({
            data: books,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("getAllBooks error:", error);
        res.status(500).json({ message: "Failed to fetch books" });
    }
};

exports.deleteBook = async (req, res) => {
    try {
        const { id } = req.params;
        const book = await Book.findByIdAndDelete(id);

        if (!book) return res.status(404).json({ message: "Book not found" });

        res.json({ message: "Book deleted successfully" });
    } catch (error) {
        console.error("deleteBook error:", error);
        res.status(500).json({ message: "Failed to delete book" });
    }
};
