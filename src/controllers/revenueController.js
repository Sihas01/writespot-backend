const mongoose = require("mongoose");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const Transaction = require("../models/transaction.model");
const User = require("../models/user");

const BUCKET_NAME = "writespot-uploads";
const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildCoverUrlFromPath = async (coverImagePath) => {
  if (!coverImagePath) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: coverImagePath,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const MIN_WITHDRAW_AMOUNT = 1000;

const parsePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const parseSort = (req) => {
  const sortBy = (req.query.sortBy || "date").toString().trim().toLowerCase();
  const sortFieldMap = {
    date: "createdAt",
    amount: "amount",
    type: "type",
  };
  const field = sortFieldMap[sortBy] || "createdAt";
  const sort = {};
  sort[field] = field === "amount" ? -1 : -1; // default descending
  return sort;
};

const computeSummary = async (userId) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [totals, monthTotals] = await Promise.all([
    Transaction.aggregate([
      { $match: { userId: userObjectId, status: "COMPLETED" } },
      {
        $addFields: {
          amountNumeric: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: "$type",
          amount: { $sum: "$amountNumeric" },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { userId: userObjectId, status: "COMPLETED", createdAt: { $gte: monthStart } } },
      {
        $addFields: {
          amountNumeric: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: "$type",
          amount: { $sum: "$amountNumeric" },
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
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    const results = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          type: "CREDIT",
          status: "COMPLETED",
          relatedBookId: { $ne: null },
        },
      },
      {
        $addFields: {
          relatedBookObjectId: {
            $convert: {
              input: "$relatedBookId",
              to: "objectId",
              onError: "$relatedBookId",
              onNull: null,
            },
          },
          amountNumeric: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: "$relatedBookObjectId",
          totalEarnings: { $sum: "$amountNumeric" },
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
          coverImagePath: "$book.coverImagePath",
          totalEarnings: 1,
          totalQuantity: 1,
        },
      },
      { $sort: { totalEarnings: -1 } },
    ]);

    const dataWithSignedCovers = await Promise.all(
      results.map(async (row) => {
        const coverUrl = await buildCoverUrlFromPath(row.coverImagePath);
        return { ...row, coverUrl };
      })
    );

    return res.json({ data: dataWithSignedCovers });
  } catch (error) {
    console.error("getByBook error:", error);
    return res.status(500).json({ message: "Failed to fetch earnings by book" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const sort = parseSort(req);

    const [items, total] = await Promise.all([
      Transaction.find({ userId: req.user.id })
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments({ userId: req.user.id }),
    ]);

    const data = items.map((txn) => ({
      ...txn.toObject(),
      invoiceId: txn._id ? `INV-${txn._id.toString().slice(-6).toUpperCase()}` : undefined,
      status: txn.status === "COMPLETED" ? "Completed" : txn.status || "Unknown",
      recipient: txn.recipient || "Unknown buyer",
    }));

    return res.json({
      data,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit) || 1,
        currentPage: page,
      },
    });
  } catch (error) {
    console.error("getHistory error:", error);
    return res.status(500).json({ message: "Failed to fetch transaction history" });
  }
};

exports.postWithdraw = async (req, res) => {
  try {
    const { amount } = req.body || {};
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

    const summaryBefore = await computeSummary(req.user.id);
    if (numericAmount > summaryBefore.currentBalance) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await Transaction.create({
      userId: req.user.id,
      amount: numericAmount,
      quantity: 1,
      type: "DEBIT",
      description: "withdrawal",
      status: "COMPLETED",
    });

    const summaryAfter = await computeSummary(req.user.id);

    return res.json({
      message: "Withdrawal successful",
      balance: summaryAfter.currentBalance,
    });
  } catch (error) {
    console.error("postWithdraw error:", error);
    return res.status(500).json({ message: "Failed to process withdrawal" });
  }
};

