const Book = require("../models/book.model");
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

    res.status(201).json({ message: "Book added successfully", book });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Something went wrong", error });
  }
};


// Get all books
exports.getAllBooks = async (req, res) => {
  try {
    const books = await Book.find(); 

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
    console.error("S3 Error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};


// Get books created by logged-in user
exports.getMyBooks = async (req, res) => {
  try {
    const books = await Book.find({ createdBy: req.user.id });
    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server Error" });
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
    console.error("S3 Error:", err);
    res.status(500).json({ msg: "Server error" });
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

    // Find the book
    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // Check if the user is the owner of the book
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

    // Update author if provided
    if (author) {
      book.author.firstName = author.firstName || book.author.firstName;
      book.author.lastName = author.lastName || book.author.lastName;
    }

    await book.save();

    res.json({ message: "Book updated successfully", book });
  } catch (error) {
    console.error("Update book error:", error);
    res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};

// Delete a book
exports.deleteBook = async (req, res) => {
  try {
    const { id } = req.params;

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // Check if the user is the owner of the book
    if (book.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to delete this book" });
    }

    await Book.findByIdAndDelete(id);

    res.json({ message: "Book deleted successfully" });
  } catch (error) {
    console.error("Delete book error:", error);
    res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};