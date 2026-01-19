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
    rating: { type: Number, min: 0, max: 5 },
    isbn: String,
    fileFormat: String,
    coverImagePath: String,
    manuscriptPath: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    drmEnabled: { type: Boolean, default: false },
    likesCount: { type: Number, default: 0 },
    reports: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model("Book", bookSchema);
