const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000
});

async function sendEmail(to, subject, text, html = "") {
  try {

    console.log("📨 Attempting to send email to:", to);

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html
    });

    console.log("✅ Email sent:", info.response);

  } catch (err) {
    console.error("❌ Error sending email:", err);
  }
}

module.exports = sendEmail;
