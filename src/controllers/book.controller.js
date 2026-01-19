const mongoose = require("mongoose");
const Book = require("../models/book.model");
const User = require("../models/user");
const AuthorProfile = require("../models/authorProfile.model");
const Order = require("../models/order.model");
const Review = require("../models/reviewV2.model");
const Like = require("../models/like.model");
const NewsletterSubscription = require("../models/newsletterSubscription.model");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { sendNewBookNotification } = require("../services/emailService");

// AWS S3 Configuration
const BUCKET_NAME = "writespot-uploads";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildCoverUrl = async (book) => {
  if (!book.coverImagePath) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: book.coverImagePath,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const buildProfileImageUrl = async (profile) => {
  if (!profile?.profileImage) return null;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: profile.profileImage,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
};

const buildEpubUrl = async (bookId) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `epubs/${bookId}.epub`,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // EPUB URLs last longer (1 hour)
};

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

// Calculate book rating from reviews
const calculateBookRating = async (bookId) => {
  const reviews = await Review.find({ bookId });
  if (reviews.length === 0) {
    return { averageRating: 0, reviewCount: 0 };
  }

  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = Math.round((totalRating / reviews.length) * 10) / 10; // Round to 1 decimal place

  return { averageRating, reviewCount: reviews.length };
};

// Add a new book
exports.addBook = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      description,
      authorFirstName,
      authorLastName,
      genre,
      language,
      keywords,
      price,
      discount,
      isbn,
      fileFormat,
      coverImage,
      manuscript,
      drmEnabled
    } = req.body;

    // Validate required fields
    if (!title || !authorFirstName || !authorLastName) {
      return res.status(400).json({ message: "Title and author are required." });
    }

    const book = await Book.create({
      title,
      subtitle,
      description,
      author: { firstName: authorFirstName, lastName: authorLastName },
      genre,
      language,
      keywords: keywords ? keywords.split(",") : [],
      price: Number(price),
      discount: Number(discount) || 0,
      isbn,
      fileFormat,
      coverImagePath: coverImage,
      manuscriptPath: manuscript,
      drmEnabled,
      createdBy: req.user.id
    });

    const axios = require("axios");
    axios.post(process.env.CONVERSION_SERVICE_URL, {
      bookId: book._id,
      manuscriptKey: manuscript,
      language: language,
    })
      .catch(err => console.error("EPUB conversion request failed:", err.message));

    // Send email notifications to subscribers (non-blocking)
    (async () => {
      try {
        // Get author profile
        const authorProfile = await AuthorProfile.findOne({ user: req.user.id })
          .populate("user", "name email");

        if (authorProfile) {
          // Get all active subscribers
          const subscriptions = await NewsletterSubscription.find({
            authorId: authorProfile._id,
            isActive: true,
          }).populate("subscriberId", "name email");

          if (subscriptions.length > 0) {
            // Get book cover URL for email
            const coverUrl = await buildCoverUrl(book);

            // Format subscribers for email service
            const subscribers = subscriptions.map((sub) => ({
              unsubscribeToken: sub.unsubscribeToken,
              subscriberEmail: sub.subscriberId?.email || "",
              subscriberName: sub.subscriberId?.name || "Subscriber",
            }));

            // Prepare book object with cover URL
            const bookWithCover = {
              ...book.toObject(),
              coverUrl,
            };

            // Send emails (non-blocking, errors logged but don't fail book creation)
            sendNewBookNotification(bookWithCover, authorProfile, subscribers)
              .then((result) => {
                console.log(`Newsletter emails sent: ${result.sent} successful, ${result.failed} failed`);
              })
              .catch((err) => {
                console.error("Error sending newsletter emails:", err);
              });
          }
        }
      } catch (err) {
        console.error("Error preparing newsletter emails:", err);
        // Don't fail book creation if email preparation fails
      }
    })();

    res.status(201).json({ message: "Book added successfully", book });
  } catch (error) {
    console.error("Add book error:", error);
    res.status(500).json({ message: "Something went wrong while adding the book.", error: error.message });
  }
};

// Get all books
// Get all books
exports.getAllBooks = async (req, res) => {
  try {
    const {
      genre,
      language,
      ratingMin,
      page = 1,
      limit = 10,
    } = req.query;

    // DEBUG: Check auth
    console.log("getAllBooks Auth Debug:", {
      hasHeader: !!req.header("Authorization"),
      userId: req.user?.id
    });

    const escapeRegExp = (value) =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizeList = (value) => {
      if (!value) return [];
      const list = Array.isArray(value) ? value : String(value).split(",");
      return list.map((item) => item.trim()).filter(Boolean);
    };

    const filters = {};
    const genres = normalizeList(genre);
    const languages = normalizeList(language);

    if (genres.length) {
      filters.genre = {
        $in: genres.map(
          (item) => new RegExp(`^${escapeRegExp(item)}$`, "i")
        ),
      };
    }

    if (languages.length) {
      filters.language = {
        $in: languages.map(
          (item) => new RegExp(`^${escapeRegExp(item)}$`, "i")
        ),
      };
    }

    if (!Number.isNaN(Number(ratingMin))) {
      filters.rating = { $gte: Number(ratingMin) };
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 10, 1), 50);

    const books = await Book.find(filters)
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize);

    const ownedIds = req.user?.id
      ? new Set(await getOwnedBookIds(req.user.id))
      : null;

    const likedBookIds = req.user?.id
      ? new Set((await Like.find({ userId: new mongoose.Types.ObjectId(req.user.id) }).select("bookId")).map(l => l.bookId.toString()))
      : new Set();

    console.log(`DEBUG: User ${req.user?.id} has liked books:`, Array.from(likedBookIds));

    const booksWithCoverUrls = await Promise.all(
      books.map(async (book) => {
        const coverUrl = await buildCoverUrl(book);
        const { averageRating } = await calculateBookRating(book._id);
        return {
          ...book.toObject(),
          coverUrl,
          averageRating,
          isOwned: ownedIds
            ? ownedIds.has(book._id.toString())
            : false,
          isLiked: likedBookIds.has(book._id.toString()),
        };
      })
    );

    res.json({
      books: booksWithCoverUrls,
      debug: {
        authHeader: !!req.header("Authorization"),
        userId: req.user?.id || "guest",
        likedCount: likedBookIds.size,
        likedIds: Array.from(likedBookIds)
      }
    });
  } catch (err) {
    console.error("Get all books error:", err);
    res.status(500).json({
      message: "Something went wrong while fetching books.",
    });
  }
};


// Get book by ID (public)
exports.getBookById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book id" });
    }

    const book = await Book.findById(id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const coverUrl = await buildCoverUrl(book);

    let isOwned = false;
    let canReview = false;
    let userReview = null;

    if (req.user?.id) {
      const ownedIds = await getOwnedBookIds(req.user.id);
      isOwned = ownedIds.includes(book._id.toString());

      // Check if user can review (has purchased and hasn't reviewed yet)
      if (isOwned) {
        userReview = await Review.findOne({ bookId: book._id, userId: req.user.id });
        canReview = !userReview;
      }
    }

    // Get review statistics
    const reviewStats = await calculateBookRating(book._id);

    let authorProfile = null;
    if (book.createdBy) {
      const [authorUser, profile] = await Promise.all([
        User.findById(book.createdBy).select("name email role"),
        AuthorProfile.findOne({ user: book.createdBy }),
      ]);
      if (authorUser) {
        const profileImageUrl = await buildProfileImageUrl(profile);
        authorProfile = {
          id: authorUser._id,
          name: authorUser.name,
          email: authorUser.email,
          role: authorUser.role,
          profileId: profile?._id,
          profileImageUrl,
        };
      }
    }

    const response = {
      ...book.toObject(),
      coverUrl,
      authorProfile,
      isOwned,
      averageRating: reviewStats.averageRating,
      reviewCount: reviewStats.reviewCount,
      canReview,
      userReview: userReview ? {
        _id: userReview._id,
        rating: userReview.rating,
        reviewText: userReview.reviewText,
        createdAt: userReview.createdAt,
        updatedAt: userReview.updatedAt,
      } : null,
    };

    res.json(response);
  } catch (error) {
    console.error("Get book by id error:", error);
    res.status(500).json({
      message: "Something went wrong while fetching the book.",
      error: error.message,
    });
  }
};

// Get books created by logged-in user
exports.getMyBooks = async (req, res) => {
  try {
    const books = await Book.find({ createdBy: req.user.id });
    res.json(books);
  } catch (err) {
    console.error("Get my books error:", err);
    res.status(500).json({ message: "Something went wrong while fetching your books." });
  }
};

// Get author books with signed S3 URLs
exports.getAuthorBooks = async (req, res) => {
  try {
    const userId = req.user.id;
    const books = await Book.find({ createdBy: userId });

    const booksWithCoverUrls = await Promise.all(
      books.map(async (book) => {
        let coverUrl = null;
        if (book.coverImagePath) {
          const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: book.coverImagePath,
          });
          coverUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        }
        return { ...book.toObject(), coverUrl };
      })
    );

    res.json(booksWithCoverUrls);
  } catch (err) {
    console.error("Get author books error:", err);
    res.status(500).json({ message: "Something went wrong while fetching author books." });
  }
};

// Get purchased books for a reader
exports.getMyLibrary = async (req, res) => {
  try {
    const ownedBookIds = await getOwnedBookIds(req.user.id);
    if (!ownedBookIds.length) {
      return res.json([]);
    }

    const books = await Book.find({ _id: { $in: ownedBookIds } });
    const booksWithCoverUrls = await Promise.all(
      books.map(async (book) => {
        const coverUrl = await buildCoverUrl(book);
        return { ...book.toObject(), coverUrl };
      })
    );

    res.json(booksWithCoverUrls);
  } catch (err) {
    console.error("Get my library error:", err);
    res.status(500).json({ message: "Something went wrong while fetching your library." });
  }
};

// Get book by ID for reader with ownership flag
exports.getBookByIdForReader = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book id" });
    }

    const book = await Book.findById(id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const coverUrl = await buildCoverUrl(book);

    let authorProfile = null;
    if (book.createdBy) {
      const [authorUser, profile] = await Promise.all([
        User.findById(book.createdBy).select("name email role"),
        AuthorProfile.findOne({ user: book.createdBy }),
      ]);
      if (authorUser) {
        const profileImageUrl = await buildProfileImageUrl(profile);
        authorProfile = {
          id: authorUser._id,
          name: authorUser.name,
          email: authorUser.email,
          role: authorUser.role,
          profileId: profile?._id,
          profileImageUrl,
        };
      }
    }

    const ownedBookIds = await getOwnedBookIds(req.user.id);
    const isOwned = ownedBookIds.includes(book._id.toString());

    // Get review statistics
    const reviewStats = await calculateBookRating(book._id);

    // Check if user can review (has purchased and hasn't reviewed yet)
    let canReview = false;
    let userReview = null;
    let isLiked = false;
    if (isOwned) {
      userReview = await Review.findOne({ bookId: book._id, userId: req.user.id });
      canReview = !userReview;
    }

    if (req.user?.id) {
      const like = await Like.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        bookId: book._id
      });
      isLiked = !!like;
    }

    const response = {
      ...book.toObject(),
      coverUrl,
      authorProfile,
      isOwned,
      isLiked,
      averageRating: reviewStats.averageRating,
      reviewCount: reviewStats.reviewCount,
      canReview,
      userReview: userReview ? {
        _id: userReview._id,
        rating: userReview.rating,
        reviewText: userReview.reviewText,
        createdAt: userReview.createdAt,
        updatedAt: userReview.updatedAt,
      } : null,
    };

    if (isOwned) {
      delete response.price;
      delete response.discount;
      try {
        response.epubUrl = await buildEpubUrl(book._id);
      } catch (err) {
        console.error("Error generating EPUB URL:", err);
      }

      // Add reading progress if available
      if (req.user?.id) {
        const user = await User.findById(req.user.id).select("readingProgress");
        const progressRec = user?.readingProgress?.find(p => p.bookId.toString() === book._id.toString());
        if (progressRec) {
          response.readingProgress = {
            cfi: progressRec.cfi,
            percentage: progressRec.percentage,
            timestamp: progressRec.timestamp
          };
        }
      }
    }

    res.json(response);
  } catch (error) {
    console.error("Get book by id (reader) error:", error);
    res.status(500).json({
      message: "Something went wrong while fetching the book.",
      error: error.message,
    });
  }
};

exports.saveReadingProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const { cfi, percentage } = req.body;
    const userId = req.user.id;

    if (!cfi) return res.status(400).json({ message: "CFI location is required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check if progress for this book already exists
    const existingIndex = user.readingProgress.findIndex(p => p.bookId.toString() === id);

    if (existingIndex > -1) {
      // Update existing
      user.readingProgress[existingIndex].cfi = cfi;
      user.readingProgress[existingIndex].percentage = percentage;
      user.readingProgress[existingIndex].timestamp = new Date();
    } else {
      // Add new
      user.readingProgress.push({
        bookId: id,
        cfi,
        percentage,
        timestamp: new Date()
      });
    }

    await user.save();
    res.json({ message: "Progress saved" });
  } catch (error) {
    console.error("Save reading progress error:", error);
    res.status(500).json({ message: "Failed to save reading progress" });
  }
};

exports.updateBook = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      description,
      genre,
      language,
      keywords,
      price,
      discount,
      isbn,
      fileFormat,
      author,
    } = req.body;

    const book = await Book.findById(id);
    if (!book) return res.status(404).json({ message: "Book not found" });

    if (book.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to update this book" });
    }

    // Update book fields
    book.title = title || book.title;
    book.subtitle = subtitle || book.subtitle;
    book.description = description || book.description;
    book.genre = genre || book.genre;
    book.language = language || book.language;
    book.keywords = Array.isArray(keywords) ? keywords : book.keywords;
    book.price = price !== undefined ? Number(price) : book.price;
    book.discount = discount !== undefined ? Number(discount) : book.discount;
    book.isbn = isbn !== undefined ? isbn : book.isbn;
    book.fileFormat = fileFormat || book.fileFormat;

    if (author) {
      book.author.firstName = author.firstName || book.author.firstName;
      book.author.lastName = author.lastName || book.author.lastName;
    }

    await book.save();
    res.json({ message: "Book updated successfully", book });
  } catch (error) {
    console.error("Update book error:", error);
    res.status(500).json({ message: "Something went wrong while updating the book.", error: error.message });
  }
};

// Delete a book
exports.deleteBook = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await Book.findById(id);

    if (!book) return res.status(404).json({ message: "Book not found" });

    if (book.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to delete this book" });
    }

    await Book.findByIdAndDelete(id);
    res.json({ message: "Book deleted successfully" });
  } catch (error) {
    console.error("Delete book error:", error);
    res.status(500).json({ message: "Something went wrong while deleting the book.", error: error.message });
  }
};

// Report a book
exports.reportBook = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const book = await Book.findById(id);
    if (!book) return res.status(404).json({ message: "Book not found" });

    book.reports.push({
      userId: req.user.id,
      reason,
      createdAt: new Date()
    });

    await book.save();
    res.json({ message: "Report submitted successfully" });
  } catch (error) {
    console.error("Report book error:", error);
    res.status(500).json({ message: "Failed to submit report" });
  }
};
