const Transaction = require("../models/transaction.model");
const User = require("../models/user");

const MIN_WITHDRAW_AMOUNT = 1000;

const parsePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const computeSummary = async (userId) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totals, monthTotals] = await Promise.all([
    Transaction.aggregate([
      { $match: { userId, status: "COMPLETED" } },
      {
        $group: {
          _id: "$type",
          amount: { $sum: "$amount" },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { userId, status: "COMPLETED", createdAt: { $gte: monthStart } } },
      {
        $group: {
          _id: "$type",
          amount: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  const totalCredits = totals.find((t) => t._id === "CREDIT")?.amount || 0;
  const totalDebits = totals.find((t) => t._id === "DEBIT")?.amount || 0;
  const thisMonthCredits = monthTotals.find((t) => t._id === "CREDIT")?.amount || 0;

  return {
    currentBalance: totalCredits - totalDebits,
    totalEarnings: totalCredits,
    totalWithdrawn: totalDebits,
    thisMonthEarnings: thisMonthCredits,
  };
};

exports.getSummary = async (req, res) => {
  try {
    const summary = await computeSummary(req.user.id);
    return res.json(summary);
  } catch (error) {
    console.error("getSummary error:", error);
    return res.status(500).json({ message: "Failed to fetch revenue summary" });
  }
};

exports.getByBook = async (req, res) => {
  try {
    const results = await Transaction.aggregate([
      { $match: { userId: req.user.id, type: "CREDIT", status: "COMPLETED", relatedBookId: { $ne: null } } },
      {
        $group: {
          _id: "$relatedBookId",
          totalEarnings: { $sum: "$amount" },
          totalQuantity: { $sum: "$quantity" },
        },
      },
      {
        $lookup: {
          from: "books",
          localField: "_id",
          foreignField: "_id",
          as: "book",
        },
      },
      { $unwind: { path: "$book", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          bookId: "$_id",
          title: "$book.title",
          totalEarnings: 1,
          totalQuantity: 1,
        },
      },
      { $sort: { totalEarnings: -1 } },
    ]);

    return res.json({ data: results });
  } catch (error) {
    console.error("getByBook error:", error);
    return res.status(500).json({ message: "Failed to fetch earnings by book" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);

    const [items, total] = await Promise.all([
      Transaction.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments({ userId: req.user.id }),
    ]);

    return res.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("getHistory error:", error);
    return res.status(500).json({ message: "Failed to fetch transaction history" });
  }
};

exports.postWithdraw = async (req, res) => {
  try {
    const { amount, bankDetails } = req.body || {};
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (numericAmount < MIN_WITHDRAW_AMOUNT) {
      return res.status(400).json({ message: `Minimum withdrawal is ${MIN_WITHDRAW_AMOUNT}` });
    }

    const user = await User.findById(req.user.id).select("isVerified");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    const summary = await computeSummary(req.user.id);
    if (numericAmount > summary.currentBalance) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await Transaction.create({
      userId: req.user.id,
      amount: numericAmount,
      quantity: 1,
      type: "DEBIT",
      description: "Author withdrawal",
      status: "COMPLETED",
    });

    console.log("Mock Bank Service: transferring funds", { userId: req.user.id, amount: numericAmount, bankDetails });
    console.log("Mock Email Service: withdrawal confirmation", { userId: req.user.id, amount: numericAmount });

    return res.json({ message: "Withdrawal requested successfully" });
  } catch (error) {
    console.error("postWithdraw error:", error);
    return res.status(500).json({ message: "Failed to process withdrawal" });
  }
};

