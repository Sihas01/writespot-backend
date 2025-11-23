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
      createdBy: req.user.id,
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
    res.json(books);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Something went wrong", error });
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