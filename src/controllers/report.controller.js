const mongoose = require("mongoose");
const Report = require("../models/report.model");
const { REPORT_REASONS } = require("../models/report.model");
const User = require("../models/user");
const Book = require("../models/book.model");
const Review = require("../models/reviewV2.model");
const Order = require("../models/order.model");
const AuditLog = require("../models/auditLog.model");
const { sendModerationNotice } = require("../services/emailService");

const REVIEW_AUTO_DELETE_THRESHOLD = 10;

const buildReasonText = (reasons, fallback = "Multiple reports") => {
  if (Array.isArray(reasons) && reasons.length > 0) {
    return reasons.join(", ");
  }
  if (typeof reasons === "string" && reasons.trim()) {
    return reasons.trim();
  }
  return fallback;
};

const buildAdminDetails = (adminNote, reportDetails) => {
  const note = typeof adminNote === "string" ? adminNote.trim() : "";
  const reporterDetails = typeof reportDetails === "string" ? reportDetails.trim() : "";
  if (note && reporterDetails) return `${reporterDetails} | Admin note: ${note}`;
  if (note) return `Admin note: ${note}`;
  return reporterDetails || "";
};

// Helper: Get owned book IDs for a user (same pattern as review.controller.js)
const getOwnedBookIds = async (userId) => {
  const [orders, user] = await Promise.all([
    Order.find({ user: userId, status: "COMPLETED" }).select("items"),
    User.findById(userId).select("purchasedBooks"),
  ]);

  const owned = new Set();

  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.bookId) owned.add(item.bookId.toString());
    });
  });

  if (user && Array.isArray(user.purchasedBooks)) {
    user.purchasedBooks.forEach((bookId) => owned.add(bookId.toString()));
  }

  return Array.from(owned);
};

// Create a new report
exports.createReport = async (req, res) => {
  try {
    const { targetId, targetModel, reason, details } = req.body;
    const reporterId = req.user.id;

    // Validate required fields
    if (!targetId || !targetModel || !reason) {
      return res.status(400).json({
        message: "Missing required fields: targetId, targetModel, and reason are required",
      });
    }

    // Validate targetModel
    if (!["User", "Book", "Review"].includes(targetModel)) {
      return res.status(400).json({
        message: "Invalid targetModel. Must be one of: User, Book, Review",
      });
    }

    // Validate targetId format
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ message: "Invalid targetId format" });
    }

    // Validate reason for the target type
    const allowedReasons = REPORT_REASONS[targetModel];
    if (!allowedReasons || !allowedReasons.includes(reason)) {
      return res.status(400).json({
        message: `Invalid reason for ${targetModel}. Allowed reasons: ${allowedReasons?.join(", ")}`,
      });
    }

    // Verify target exists based on targetModel
    let target;
    switch (targetModel) {
      case "User":
        target = await User.findById(targetId);
        if (!target) {
          return res.status(404).json({ message: "User not found" });
        }
        // Prevent self-reporting
        if (target._id.toString() === reporterId) {
          return res.status(400).json({ message: "You cannot report yourself" });
        }
        break;

      case "Book":
        target = await Book.findById(targetId);
        if (!target) {
          return res.status(404).json({ message: "Book not found" });
        }
        // Purchase gate: verify user has purchased the book
        const ownedBookIds = await getOwnedBookIds(reporterId);
        if (!ownedBookIds.includes(targetId.toString())) {
          return res.status(403).json({
            message: "You can only report books you have purchased",
          });
        }
        break;

      case "Review":
        target = await Review.findById(targetId);
        if (!target) {
          return res.status(404).json({ message: "Review not found" });
        }
        // Prevent self-reporting
        if (target.userId.toString() === reporterId) {
          return res.status(400).json({ message: "You cannot report your own review" });
        }
        break;
    }

    // Create the report
    const report = new Report({
      reporter: reporterId,
      targetId,
      targetModel,
      reason,
      details: details || "",
    });

    await report.save();

    if (targetModel === "Review") {
      const totalReports = await Report.countDocuments({
        targetId,
        targetModel: "Review",
      });

      if (totalReports >= REVIEW_AUTO_DELETE_THRESHOLD) {
        const review = await Review.findById(targetId)
          .populate("userId", "name email")
          .populate("bookId", "title");

        if (review) {
          await Review.findByIdAndDelete(targetId);

          const reviewTitle = review.bookId?.title
            ? `Review on "${review.bookId.title}"`
            : "Review";

          try {
            await sendModerationNotice(review.userId?.email, "CONTENT_DELETED", "Multiple reports", {
              userName: review.userId?.name,
              contentType: "review",
              contentTitle: reviewTitle,
              additionalDetails: `Auto-deleted after ${totalReports} reports.`,
            });
          } catch (emailError) {
            console.error("Failed to send moderation notice:", emailError);
          }
        }

        await Report.updateMany(
          { targetId, targetModel: "Review", status: { $ne: "resolved" } },
          { status: "resolved" }
        );
      }
    }

    res.status(201).json({
      message: "Report submitted successfully",
      report: {
        _id: report._id,
        targetId: report.targetId,
        targetModel: report.targetModel,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    // Handle duplicate key error (user already reported this item)
    if (error.code === 11000) {
      return res.status(400).json({
        message: "You have already reported this",
      });
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    console.error("Create report error:", error);
    res.status(500).json({ message: "Something went wrong while submitting the report" });
  }
};

// Get reports (for admin use)
exports.getReports = async (req, res) => {
  try {
    const { status, targetModel, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (targetModel) filter.targetModel = targetModel;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .populate("reporter", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Report.countDocuments(filter),
    ]);

    const hydratedReports = await Promise.all(
      reports.map(async (report) => {
        if (report.targetModel === "Book") {
          const book = await Book.findById(report.targetId)
            .select("title author createdBy")
            .populate("createdBy", "name email");
          return { ...report, target: book };
        }

        if (report.targetModel === "Review") {
          const review = await Review.findById(report.targetId)
            .select("reviewText bookId userId")
            .populate("userId", "name email")
            .populate("bookId", "title");
          return { ...report, target: review };
        }

        if (report.targetModel === "User") {
          const user = await User.findById(report.targetId).select("name email role");
          return { ...report, target: user };
        }

        return report;
      })
    );

    res.json({
      reports: hydratedReports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get reports error:", error);
    res.status(500).json({ message: "Something went wrong while fetching reports" });
  }
};

// Resolve report with moderation action
exports.resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, adminNote } = req.body;

    if (!["DISMISS", "DELETE_TARGET", "SUSPEND_USER"].includes(action)) {
      return res.status(400).json({
        message: "Invalid action. Must be one of: DISMISS, DELETE_TARGET, SUSPEND_USER",
      });
    }

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    const adminId = req.user?.id;

    if (action === "DISMISS") {
      report.status = "dismissed";
      await report.save();
      return res.json({ message: "Report dismissed", report });
    }

    if (action === "DELETE_TARGET") {
      if (!["Book", "Review"].includes(report.targetModel)) {
        return res.status(400).json({
          message: "DELETE_TARGET is only valid for Book or Review reports",
        });
      }

      if (report.targetModel === "Book") {
        const book = await Book.findById(report.targetId).populate("createdBy", "name email");
        if (!book) {
          return res.status(404).json({ message: "Book not found" });
        }

        await Book.findByIdAndDelete(report.targetId);

        try {
          await sendModerationNotice(book.createdBy?.email, "CONTENT_DELETED", report.reason, {
            userName: book.createdBy?.name,
            contentType: "book",
            contentTitle: book.title || "Untitled Book",
            additionalDetails: buildAdminDetails(adminNote, report.details),
          });
        } catch (emailError) {
          console.error("Failed to send moderation notice:", emailError);
        }

        if (adminId) {
          await AuditLog.create({
            adminId,
            action: "DELETE_BOOK",
            targetType: "Book",
            targetId: book._id,
            targetName: book.title || "Untitled Book",
            details: buildReasonText(report.reason) + (adminNote ? ` | Admin note: ${adminNote}` : ""),
          });
        }
      }

      if (report.targetModel === "Review") {
        const review = await Review.findById(report.targetId)
          .populate("userId", "name email")
          .populate("bookId", "title");
        if (!review) {
          return res.status(404).json({ message: "Review not found" });
        }

        await Review.findByIdAndDelete(report.targetId);

        const reviewTitle = review.bookId?.title
          ? `Review on "${review.bookId.title}"`
          : "Review";

        try {
          await sendModerationNotice(review.userId?.email, "CONTENT_DELETED", report.reason, {
            userName: review.userId?.name,
            contentType: "review",
            contentTitle: reviewTitle,
            additionalDetails: buildAdminDetails(adminNote, report.details),
          });
        } catch (emailError) {
          console.error("Failed to send moderation notice:", emailError);
        }
      }

      report.status = "resolved";
      await report.save();
      return res.json({ message: "Report resolved and content deleted", report });
    }

    if (action === "SUSPEND_USER") {
      if (report.targetModel !== "User") {
        return res.status(400).json({
          message: "SUSPEND_USER is only valid for User reports",
        });
      }

      const user = await User.findById(report.targetId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role === "admin") {
        return res.status(400).json({ message: "Admin users cannot be suspended" });
      }

      user.status = "suspended";
      await user.save();

      try {
        await sendModerationNotice(user.email, "ACCOUNT_SUSPENDED", report.reason, {
          userName: user.name,
          additionalDetails: buildAdminDetails(adminNote, report.details),
        });
      } catch (emailError) {
        console.error("Failed to send moderation notice:", emailError);
      }

      if (adminId) {
        await AuditLog.create({
          adminId,
          action: "SUSPEND_USER",
          targetType: "User",
          targetId: user._id,
          targetName: user.name || "User",
          details: buildReasonText(report.reason) + (adminNote ? ` | Admin note: ${adminNote}` : ""),
        });
      }

      report.status = "resolved";
      await report.save();
      return res.json({ message: "Report resolved and user suspended", report });
    }

    return res.status(400).json({ message: "Unhandled action" });
  } catch (error) {
    console.error("Resolve report error:", error);
    res.status(500).json({ message: "Something went wrong while resolving the report" });
  }
};

// Update report status (for admin use)
exports.updateReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status } = req.body;

    if (!["pending", "reviewed", "dismissed"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be one of: pending, reviewed, dismissed",
      });
    }

    const report = await Report.findByIdAndUpdate(
      reportId,
      { status },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.json({
      message: "Report status updated",
      report,
    });
  } catch (error) {
    console.error("Update report status error:", error);
    res.status(500).json({ message: "Something went wrong while updating the report" });
  }
};

// Admin: Get authors with report counts
exports.getAuthorReportSummary = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "pending" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const matchReports = {
      $expr: {
        $and: [
          { $eq: ["$targetId", "$$authorId"] },
          { $eq: ["$targetModel", "User"] },
        ],
      },
    };
    if (status) {
      matchReports.status = status;
    }

    const authors = await User.aggregate([
      { $match: { role: "author" } },
      {
        $lookup: {
          from: "reports",
          let: { authorId: "$_id" },
          pipeline: [{ $match: matchReports }],
          as: "reports",
        },
      },
      { $addFields: { reportCount: { $size: "$reports" } } },
      { $sort: { reportCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $project: {
          password: 0,
          otp: 0,
          resetToken: 0,
          resetTokenExpires: 0,
          reports: 0,
        },
      },
    ]);

    const total = await User.countDocuments({ role: "author" });

    res.json({
      data: authors,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("getAuthorReportSummary error:", error);
    res.status(500).json({ message: "Failed to fetch author reports" });
  }
};

// Admin: Get reports for a specific author
exports.getAuthorReports = async (req, res) => {
  try {
    const { authorId } = req.params;
    const { status = "pending" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    const author = await User.findById(authorId).select("name email role");
    if (!author || author.role !== "author") {
      return res.status(404).json({ message: "Author not found" });
    }

    const filter = { targetId: authorId, targetModel: "User" };
    if (status) filter.status = status;

    const reports = await Report.find(filter)
      .populate("reporter", "name email")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ author, reports });
  } catch (error) {
    console.error("getAuthorReports error:", error);
    res.status(500).json({ message: "Failed to fetch author reports" });
  }
};

// Admin: Suspend author based on reports
exports.suspendAuthorFromReports = async (req, res) => {
  try {
    const { authorId } = req.params;
    const { reasons, adminNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    const author = await User.findById(authorId);
    if (!author || author.role !== "author") {
      return res.status(404).json({ message: "Author not found" });
    }

    author.status = "suspended";
    await author.save();

    const reasonText = buildReasonText(reasons);

    try {
      await sendModerationNotice(author.email, "ACCOUNT_SUSPENDED", reasonText, {
        userName: author.name,
        additionalDetails: buildAdminDetails(adminNote),
      });
    } catch (emailError) {
      console.error("Failed to send moderation notice:", emailError);
    }

    await Report.updateMany(
      { targetId: authorId, targetModel: "User", status: { $ne: "resolved" } },
      { status: "resolved" }
    );

    await AuditLog.create({
      adminId: req.user.id,
      action: "SUSPEND_USER",
      targetType: "User",
      targetId: author._id,
      targetName: author.name,
      details: reasonText + (adminNote ? ` | Admin note: ${adminNote}` : ""),
    });

    res.json({ message: "Author suspended and reports resolved" });
  } catch (error) {
    console.error("suspendAuthorFromReports error:", error);
    res.status(500).json({ message: "Failed to suspend author" });
  }
};

// Admin: Delete author based on reports
exports.deleteAuthorFromReports = async (req, res) => {
  try {
    const { authorId } = req.params;
    const { reasons, adminNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    const author = await User.findById(authorId);
    if (!author || author.role !== "author") {
      return res.status(404).json({ message: "Author not found" });
    }

    const reasonText = buildReasonText(reasons);

    try {
      await sendModerationNotice(author.email, "ACCOUNT_DELETED", reasonText, {
        userName: author.name,
        additionalDetails: buildAdminDetails(adminNote),
      });
    } catch (emailError) {
      console.error("Failed to send moderation notice:", emailError);
    }

    await User.findByIdAndDelete(authorId);

    await Report.updateMany(
      { targetId: authorId, targetModel: "User", status: { $ne: "resolved" } },
      { status: "resolved" }
    );

    await AuditLog.create({
      adminId: req.user.id,
      action: "DELETE_USER",
      targetType: "User",
      targetId: author._id,
      targetName: author.name,
      details: reasonText + (adminNote ? ` | Admin note: ${adminNote}` : ""),
    });

    res.json({ message: "Author deleted and reports resolved" });
  } catch (error) {
    console.error("deleteAuthorFromReports error:", error);
    res.status(500).json({ message: "Failed to delete author" });
  }
};

// Admin: Activate author account
exports.activateAuthorFromReports = async (req, res) => {
  try {
    const { authorId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(authorId)) {
      return res.status(400).json({ message: "Invalid author ID" });
    }

    const author = await User.findById(authorId);
    if (!author || author.role !== "author") {
      return res.status(404).json({ message: "Author not found" });
    }

    author.status = "active";
    await author.save();

    await AuditLog.create({
      adminId: req.user.id,
      action: "ACTIVATE_USER",
      targetType: "User",
      targetId: author._id,
      targetName: author.name,
      details: "Author account reactivated",
    });

    res.json({ message: "Author reactivated successfully" });
  } catch (error) {
    console.error("activateAuthorFromReports error:", error);
    res.status(500).json({ message: "Failed to reactivate author" });
  }
};

// Admin: Get books with report counts
exports.getBookReportSummary = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "pending" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const matchReports = {
      $expr: {
        $and: [
          { $eq: ["$targetId", "$$bookId"] },
          { $eq: ["$targetModel", "Book"] },
        ],
      },
    };
    if (status) {
      matchReports.status = status;
    }

    const books = await Book.aggregate([
      {
        $lookup: {
          from: "reports",
          let: { bookId: "$_id" },
          pipeline: [{ $match: matchReports }],
          as: "reports",
        },
      },
      { $addFields: { reportCount: { $size: "$reports" } } },
      { $sort: { reportCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    const populatedBooks = await Book.populate(books, {
      path: "createdBy",
      select: "name email",
    });

    const total = await Book.countDocuments();

    res.json({
      data: populatedBooks,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("getBookReportSummary error:", error);
    res.status(500).json({ message: "Failed to fetch book reports" });
  }
};

// Admin: Get reports for a specific book
exports.getBookReports = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { status = "pending" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const book = await Book.findById(bookId).populate("createdBy", "name email");
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const filter = { targetId: bookId, targetModel: "Book" };
    if (status) filter.status = status;

    const reports = await Report.find(filter)
      .populate("reporter", "name email")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ book, reports });
  } catch (error) {
    console.error("getBookReports error:", error);
    res.status(500).json({ message: "Failed to fetch book reports" });
  }
};

// Admin: Remove book based on reports
exports.removeBookFromReports = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { reasons, adminNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const book = await Book.findById(bookId).populate("createdBy", "name email");
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const reasonText = buildReasonText(reasons);

    await Book.findByIdAndDelete(bookId);

    try {
      await sendModerationNotice(book.createdBy?.email, "CONTENT_DELETED", reasonText, {
        userName: book.createdBy?.name,
        contentType: "book",
        contentTitle: book.title || "Untitled Book",
        additionalDetails: buildAdminDetails(adminNote),
      });
    } catch (emailError) {
      console.error("Failed to send moderation notice:", emailError);
    }

    await Report.updateMany(
      { targetId: bookId, targetModel: "Book", status: { $ne: "resolved" } },
      { status: "resolved" }
    );

    await AuditLog.create({
      adminId: req.user.id,
      action: "DELETE_BOOK",
      targetType: "Book",
      targetId: book._id,
      targetName: book.title || "Untitled Book",
      details: reasonText + (adminNote ? ` | Admin note: ${adminNote}` : ""),
    });

    res.json({ message: "Book removed and reports resolved" });
  } catch (error) {
    console.error("removeBookFromReports error:", error);
    res.status(500).json({ message: "Failed to remove book" });
  }
};
