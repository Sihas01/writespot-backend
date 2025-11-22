const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    subtitle: String,
    description: String,
    author: {
        firstName: String,
        lastName: String,
    },
    genre: String,
    language: String,
    keywords: [String],
    price: Number,
    discount: Number,
    isbn: String,
    fileFormat: String,
    coverImagePath: String,
    manuscriptPath: String,
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Book", bookSchema);
