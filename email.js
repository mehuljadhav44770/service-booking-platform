// email.js
const nodemailer = require("nodemailer");
require("dotenv").config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send Email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 * @param {string} html - HTML body (optional)
 */
async function sendEmail(to, subject, text, html = "") {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    console.log("✅ Email sent successfully to", to);
  } catch (err) {
    console.error("❌ Error sending email:", err);
  }
}

module.exports = sendEmail;
