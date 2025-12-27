const Book = require("../models/book.model");
const User = require("../models/user");
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
exports.getAllBooks = async (req, res) => {
  try {
<<<<<<< Updated upstream
    const {
      genre,
      language,
      priceMin,
      priceMax,
      ratingMin,
      page = 1,
      limit = 10,
    } = req.query;
=======
    const { genre, language, minPrice, maxPrice } = req.query;

    const filters = {};

    const genreValue = typeof genre === "string" ? genre.trim() : "";
    if (genreValue) {
      filters.genre = genreValue;
    }

    const languageValue = typeof language === "string" ? language.trim() : "";
    if (languageValue) {
      filters.language = languageValue;
    }

    const priceFilter = {};
    const parsedMinPrice =
      typeof minPrice === "string" && minPrice !== "" ? Number(minPrice) : NaN;
    const parsedMaxPrice =
      typeof maxPrice === "string" && maxPrice !== "" ? Number(maxPrice) : NaN;

    if (Number.isFinite(parsedMinPrice)) {
      priceFilter.$gte = parsedMinPrice;
    }

    if (Number.isFinite(parsedMaxPrice)) {
      priceFilter.$lte = parsedMaxPrice;
    }

    if (Object.keys(priceFilter).length) {
      filters.price = priceFilter;
    }

    const books = await Book.find(filters);
>>>>>>> Stashed changes

    const filters = {};

    if (genre) filters.genre = genre;
    if (language) filters.language = language;

    const priceFilter = {};
    const minPrice = Number(priceMin);
    const maxPrice = Number(priceMax);
    if (!Number.isNaN(minPrice)) priceFilter.$gte = minPrice;
    if (!Number.isNaN(maxPrice)) priceFilter.$lte = maxPrice;
    if (Object.keys(priceFilter).length) filters.price = priceFilter;

    const ratingFilter = {};
    const minRating = Number(ratingMin);
    if (!Number.isNaN(minRating)) ratingFilter.$gte = minRating;
    if (Object.keys(ratingFilter).length) filters.rating = ratingFilter;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const pageNum = Math.max(!Number.isNaN(parsedPage) ? parsedPage : 1, 1);
    const pageSize = Math.min(
      Math.max(!Number.isNaN(parsedLimit) ? parsedLimit : 10, 1),
      50
    );

    const books = await Book.find(filters)
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize);

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
    console.error("Get all books error:", err);
    res.status(500).json({ message: "Something went wrong while fetching books." });
  }
};

// Get book by ID (public)
exports.getBookById = async (req, res) => {
  try {
    const { id } = req.params;

    const book = await Book.findById(id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    let coverUrl = null;
    if (book.coverImagePath) {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: book.coverImagePath,
      });
      coverUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    }

    let authorProfile = null;
    if (book.createdBy) {
      const authorUser = await User.findById(book.createdBy).select(
        "name email role"
      );
      if (authorUser) {
        authorProfile = {
          id: authorUser._id,
          name: authorUser.name,
          email: authorUser.email,
          role: authorUser.role,
        };
      }
    }

    const response = {
      ...book.toObject(),
      coverUrl,
      authorProfile,
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
