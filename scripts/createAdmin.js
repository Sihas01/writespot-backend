const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../src/models/user");
require("dotenv").config();

async function createAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("DB Connected");

        const adminEmail = "admin@writespot.com";
        const password = "admin123";

        const existingAdmin = await User.findOne({ email: adminEmail });
        if (existingAdmin) {
            console.log("Admin user already exists");
            process.exit(0);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const adminUser = new User({
            name: "Super Admin",
            email: adminEmail,
            password: hashedPassword,
            role: "admin",
            isVerified: true, // Auto-verify admin
        });

        await adminUser.save();
        console.log(`Admin user created: ${adminEmail} / ${password}`);
        process.exit(0);
    } catch (error) {
        console.error("Error creating admin:", error);
        process.exit(1);
    }
}

createAdmin();
