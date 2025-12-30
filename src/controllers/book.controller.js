const mongoose = require("mongoose");
const Book = require("../models/book.model");
const User = require("../models/user");
const AuthorProfile = require("../models/authorProfile.model");
const Order = require("../models/order.model");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

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

    const booksWithCoverUrls = await Promise.all(
      books.map(async (book) => {
        const coverUrl = await buildCoverUrl(book);
        return {
          ...book.toObject(),
          coverUrl,
          isOwned: ownedIds
            ? ownedIds.has(book._id.toString())
            : false,
        };
      })
    );

    res.json(booksWithCoverUrls);
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
    if (req.user?.id) {
      const ownedIds = await getOwnedBookIds(req.user.id);
      isOwned = ownedIds.includes(book._id.toString());
    }

    const authorProfile = await getAuthorProfileData(book.createdBy);

    const response = {
      ...book.toObject(),
      coverUrl,
      authorProfile,
      isOwned,
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

    const authorProfile = await getAuthorProfileData(book.createdBy);

    const ownedBookIds = await getOwnedBookIds(req.user.id);
    const isOwned = ownedBookIds.includes(book._id.toString());

    const response = {
      ...book.toObject(),
      coverUrl,
      authorProfile,
      isOwned,
    };

    if (isOwned) {
      delete response.price;
      delete response.discount;
      try {
        response.epubUrl = await buildEpubUrl(book._id);
      } catch (err) {
        console.error("Error generating EPUB URL:", err);
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
