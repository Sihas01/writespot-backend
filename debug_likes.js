const mongoose = require("mongoose");
require("dotenv").config();

const userId = "69501465a2e13883f2a0ad92"; // ID from screenshot

const likeSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.Mixed,
    bookId: mongoose.Schema.Types.Mixed
}, { strict: false }); // Use strict: false and Mixed to see RAW data types

const Like = mongoose.model("Like_Debug", likeSchema, "likes"); // force collection name 'likes'

async function debug() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB");

        console.log(`Searching for likes for UserID: ${userId}`);

        // 1. Search by String
        const stringMatches = await Like.find({ userId: userId });
        console.log(`Found by String: ${stringMatches.length}`);
        if (stringMatches.length > 0) console.log(stringMatches[0]);

        // 2. Search by ObjectId
        try {
            const objectId = new mongoose.Types.ObjectId(userId);
            const oidMatches = await Like.find({ userId: objectId });
            console.log(`Found by ObjectId: ${oidMatches.length}`);
            if (oidMatches.length > 0) console.log(oidMatches[0]);
        } catch (e) {
            console.log("Invalid ObjectId casting");
        }

        // 3. Dump all (limit 5) to see structure
        const all = await Like.find().limit(5);
        console.log("Sample of ANY 5 likes in DB:");
        console.log(all);

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

debug();
