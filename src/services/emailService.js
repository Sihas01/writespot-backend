const nodemailer = require("nodemailer");
require("dotenv").config();

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

// Allow local dev without working SMTP creds.
const EMAIL_DEV_MODE = String(process.env.EMAIL_DEV_MODE).toLowerCase() === "true";

const sendMailSafe = async (options) => {
  if (EMAIL_DEV_MODE) {
    console.log("[DEV_EMAIL_MODE] Email send skipped; payload:", {
      to: options.to,
      subject: options.subject,
      preview: options.html ? options.html.slice(0, 200) : options.text,
    });
    return;
  }
  return transporter.sendMail(options);
};

// Generate unsubscribe link
const generateUnsubscribeLink = (token) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  return `${frontendUrl}/unsubscribe/${token}`;
};

// Send email in batches with delay
const sendBatchEmails = async (emailPromises, batchSize = 50, delayMs = 1000) => {
  const results = [];
  for (let i = 0; i < emailPromises.length; i += batchSize) {
    const batch = emailPromises.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((emailPromise) => emailPromise)
    );
    results.push(...batchResults);

    // Add delay between batches (except for the last batch)
    if (i + batchSize < emailPromises.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
};

// Send new book notification to subscribers
const sendNewBookNotification = async (book, author, subscribers) => {
  if (!subscribers || subscribers.length === 0) {
    console.log(`[Newsletter] No subscribers to notify for author ${author._id}`);
    return { sent: 0, failed: 0 };
  }

  const frontendUrl = process.env.FRONTEND_URL || process.env.API || "http://localhost:5173";
  const authorName = author.user?.name || `${author.author?.firstName || ""} ${author.author?.lastName || ""}`.trim() || "Author";
  const bookTitle = book.title || "New Book";
  const bookDescription = book.description || "Check out this new release!";
  const bookUrl = `${frontendUrl}/reader/dashboard/store/${book._id}`;
  const coverImageUrl = book.coverUrl || "";

  console.log(`[Newsletter] Sending publication notifications for "${bookTitle}" to ${subscribers.length} subscribers...`);

  const emailPromises = subscribers.map(async (subscription) => {
    const unsubscribeLink = generateUnsubscribeLink(subscription.unsubscribeToken);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #e5e7eb;">
            <div style="background: #16a34a; padding: 40px 20px; text-align: center;">
              <h1 style="color: white; font-size: 36px; margin: 0; font-weight: 800; letter-spacing: -0.025em;">WriteSpot</h1>
              <p style="color: #dcfce7; margin: 10px 0 0 0; font-size: 18px; font-weight: 500;">New Release Alert</p>
            </div>
            
            <div style="padding: 40px;">
              <h2 style="color: #111827; margin-top: 0; font-size: 24px; text-align: center; line-height: 1.3;">
                ${authorName} just published a new book!
              </h2>
              
              ${coverImageUrl ? `
                <div style="text-align: center; margin: 30px 0;">
                  <img src="${coverImageUrl}" alt="${bookTitle}" style="max-width: 180px; height: auto; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);" />
                </div>
              ` : ""}
              
              <div style="text-align: center; margin-bottom: 30px;">
                <h3 style="color: #111827; font-size: 28px; margin: 0 0 8px 0; font-weight: 700;">${bookTitle}</h3>
                ${book.subtitle ? `<p style="color: #6b7280; font-size: 16px; margin: 0;">${book.subtitle}</p>` : ""}
              </div>
              
              <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
                <p style="color: #4b5563; margin: 0; font-size: 15px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                  ${bookDescription}
                </p>
              </div>
              
              <div style="text-align: center;">
                ${book.price !== undefined && book.price !== null ? `
                  <div style="margin-bottom: 25px;">
                    <span style="font-size: 24px; font-weight: 700; color: #16a34a;">
                      ${book.price > 0 ? `LKR ${book.price}` : "Available for Free"}
                    </span>
                  </div>
                ` : ""}
                
                <a href="${bookUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 16px 40px; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
                  Read Now
                </a>
              </div>
            </div>
            
            <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; margin: 0; line-height: 1.5;">
                You are receiving this because you subscribed to <strong>${authorName}</strong> on WriteSpot.
              </p>
              <p style="color: #6b7280; font-size: 13px; margin: 15px 0 0 0;">
                <a href="${unsubscribeLink}" style="color: #16a34a; text-decoration: none; font-weight: 500;">Unsubscribe from this newsletter</a>
              </p>
            </div>
          </div>
          
          <div style="margin-top: 20px; text-align: center;">
            <p style="color: #9ca3af; font-size: 11px;">
              &copy; ${new Date().getFullYear()} WriteSpot. All rights reserved.
            </p>
          </div>
        </body>
      </html>
    `;

    const textContent = `
WriteSpot - New Book Release

${authorName} has published a new book!

${bookTitle}
${book.subtitle ? book.subtitle + "\n" : ""}

${bookDescription}

${book.price !== undefined && book.price !== null ? `Price: ${book.price > 0 ? `LKR ${book.price}` : "Free"}\n` : ""}

View the book: ${bookUrl}

---
You're receiving this email because you subscribed to ${authorName}'s newsletter.
Unsubscribe: ${unsubscribeLink}
    `.trim();

    return sendMailSafe({
      from: `"WriteSpot" <${process.env.EMAIL}>`,
      to: subscription.subscriberEmail,
      subject: `New Release: ${bookTitle} by ${authorName}`,
      html: htmlContent,
      text: textContent,
    });
  });

  const results = await sendBatchEmails(emailPromises);
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(`[Newsletter] Batch complete: ${sent} sent, ${failed} failed for "${bookTitle}"`);

  return { sent, failed };
};

// Send newsletter email (for future use)
const sendNewsletterEmail = async (author, subscribers, content) => {
  if (!subscribers || subscribers.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const authorName = author.user?.name || "Author";
  const unsubscribeLink = generateUnsubscribeLink(""); // Token should be per subscription

  const emailPromises = subscribers.map(async (subscription) => {
    const unsubscribeLink = generateUnsubscribeLink(subscription.unsubscribeToken);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f0fdf4; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #16a34a; font-size: 32px; margin: 0;">WriteSpot</h1>
            <p style="color: #666; margin: 10px 0 0 0;">Newsletter from ${authorName}</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
            ${content}
          </div>
          
          <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">
              You're receiving this email because you subscribed to ${authorName}'s newsletter.
            </p>
            <p style="color: #6b7280; font-size: 12px; margin: 10px 0 0 0;">
              <a href="${unsubscribeLink}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a>
            </p>
          </div>
        </body>
      </html>
    `;

    return sendMailSafe({
      from: `"WriteSpot" <${process.env.EMAIL}>`,
      to: subscription.subscriberEmail,
      subject: `Newsletter from ${authorName}`,
      html: htmlContent,
      text: content,
    });
  });

  const results = await sendBatchEmails(emailPromises);
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return { sent, failed };
};

const sendModerationNotice = async (email, type, reason, details = {}) => {
  const subjects = {
    CONTENT_DELETED: "Your content has been removed from WriteSpot",
    ACCOUNT_SUSPENDED: "Your WriteSpot account has been suspended",
    ACCOUNT_DELETED: "Your WriteSpot account has been removed",
  };

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL || "support@writespot.com";
  const userName = details.userName || "there";
  const contentType = details.contentType || "content";
  const contentTitle = details.contentTitle || "your content";
  const actionLine =
    type === "ACCOUNT_SUSPENDED"
      ? "Your account has been suspended for violating our community guidelines."
      : type === "ACCOUNT_DELETED"
        ? "Your account has been removed from WriteSpot for violating our community guidelines."
        : `Your ${contentType} "${contentTitle}" has been removed from WriteSpot for violating our community guidelines.`;
  const appealLink = `${frontendUrl}/support`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
        <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #e5e7eb;">
          <div style="background: #111827; padding: 36px 20px; text-align: center;">
            <h1 style="color: white; font-size: 30px; margin: 0; font-weight: 800; letter-spacing: -0.02em;">WriteSpot</h1>
            <p style="color: #d1d5db; margin: 8px 0 0 0; font-size: 16px; font-weight: 500;">Moderation Notice</p>
          </div>
          
          <div style="padding: 36px;">
            <p style="color: #111827; font-size: 16px; margin: 0 0 16px 0;">Hello ${userName},</p>
            <p style="margin: 0 0 16px 0;">${actionLine}</p>
            <p style="margin: 0 0 16px 0;"><strong>Reason:</strong> ${reason}</p>
            ${details.additionalDetails ? `<p style="margin: 0 0 16px 0;"><strong>Details:</strong> ${details.additionalDetails}</p>` : ""}
            <p style="margin: 0 0 16px 0;">If you believe this is a mistake, please contact our support team.</p>
            <div style="text-align: center; margin-top: 24px;">
              <a href="${appealLink}" style="display: inline-block; background: #111827; color: white; padding: 12px 24px; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 14px;">
                Contact Support
              </a>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.5;">
              Need help? Email us at <a href="mailto:${supportEmail}" style="color: #111827; text-decoration: none; font-weight: 600;">${supportEmail}</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  const textContent = `
WriteSpot Moderation Notice

Hello ${userName},

${actionLine}

Reason: ${reason}
${details.additionalDetails ? `Details: ${details.additionalDetails}\n` : ""}
If you believe this is a mistake, please contact our support team.
Support: ${supportEmail}
  `.trim();

  return sendMailSafe({
    from: `"WriteSpot" <${process.env.EMAIL}>`,
    to: email,
    subject: subjects[type] || "WriteSpot Moderation Notice",
    html: htmlContent,
    text: textContent,
  });
};

module.exports = {
  sendMailSafe,
  generateUnsubscribeLink,
  sendNewBookNotification,
  sendNewsletterEmail,
  sendBatchEmails,
  sendModerationNotice,
};
