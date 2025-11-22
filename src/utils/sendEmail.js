const nodemailer = require('nodemailer');
const config = require('./config/config'); 

// Renamed your original function to be generic
const sendGenericEmail = async (email, subject, text) => {
    try {
        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com", 
            port: 587,
            secure: false, 
            auth: {
                user: config.EMAIL_USER, 
                pass: config.EMAIL_PASS, 
            },
        });

        await transporter.sendMail({
            from: config.EMAIL_USER,
            to: email,
            subject: subject,
            text: text,
        });

        console.log("Email sent successfully to:", email);
    } catch (error) {
        console.error("Error sending email:", error.message);
        throw new Error("Email sending failed.");
    }
};

// --- THIS IS THE CRITICAL FUNCTION NEEDED BY routes/auth.js ---
// It uses the generic function above to send the specific OTP email
const sendOTP = async (email, otp) => {
    const subject = "Your One-Time Password (OTP) for Registration";
    const text = `Your OTP is: ${otp}. Please use this code to verify your account. It expires in 10 minutes.`;
    
    // Use the generic function to send the specific OTP content
    await sendGenericEmail(email, subject, text);
};


// --- FIX: Export the specific function required by routes/auth.js ---
// This uses module.exports as an object to allow destructuring { sendOTP } in auth.js
module.exports = {
    sendOTP,
    sendGenericEmail // Optional: export the generic one too
};