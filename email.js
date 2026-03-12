const nodemailer = require("nodemailer");
require("dotenv").config();

// Create transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify SMTP connection when server starts
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP connection failed:", error);
  } else {
    console.log("✅ SMTP server is ready to send emails");
  }
});

// Email sending function
async function sendEmail(to, subject, text, html = "") {
  try {

    console.log("📨 Attempting to send email to:", to);

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: to,
      subject: subject,
      text: text,
      html: html
    };

    const info = await transporter.sendMail(mailOptions);

    console.log("✅ Email sent successfully:", info.response);

  } catch (err) {
    console.error("❌ Error sending email:", err);
  }
}

module.exports = sendEmail;
