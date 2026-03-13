const { Resend } = require("resend");
require("dotenv").config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, text) {

  try {

    const response = await resend.emails.send({
      from: "QuickFix <onboarding@resend.dev>",
      to: to,
      subject: subject,
      html: `<p>${text}</p>`
    });

    console.log("✅ Email sent:", response);

  } catch (error) {
    console.error("❌ Email error:", error);
  }

}

module.exports = sendEmail;
