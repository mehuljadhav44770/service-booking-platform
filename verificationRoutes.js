require("dotenv").config();

const express = require("express");
const router = express.Router();

const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const pool = require("./db.js"); // your postgres config

/* ===================================================
   EMAIL CONFIG
=================================================== */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ===================================================
   TEMP OTP STORE
=================================================== */

const otpStore = new Map(); // email => { otp, expiry }

/* ===================================================
   SEND EMAIL OTP
=================================================== */

// router.post("/send-email-otp", async (req, res) => {

//   try {

//     const { email, otp } = req.body;

//     if (!email || !otp) {
//       return res.status(400).json({ error: "Missing email/otp" });
//     }

//     // Save OTP (5 minutes)
//     otpStore.set(email, {
//       otp,
//       expiry: Date.now() + 5 * 60 * 1000
//     });

//     await transporter.sendMail({
//       from: `"QuickFix" <${process.env.EMAIL_USER}>`,
//       to: email,
//       subject: "QuickFix Email Verification",
//       html: `
//         <h3>Email Verification</h3>
//         <p>Your OTP:</p>
//         <h1>${otp}</h1>
//         <p>Valid for 5 minutes</p>
//       `
//     });

//     res.json({ message: "OTP sent" });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Email failed" });
//   }
// });

/* ===================================================
   FILE STORAGE CONFIG
=================================================== */

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }

});

const upload = multer({

  storage,

  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB

  fileFilter: (req, file, cb) => {

    const allowed = /jpeg|jpg|png|pdf/;

    const valid =
      allowed.test(file.mimetype) &&
      allowed.test(path.extname(file.originalname).toLowerCase());

    if (valid) cb(null, true);
    else cb(new Error("Invalid file type"));
  }

});

/* ===================================================
   VERIFY + SAVE DOCUMENTS
=================================================== */

router.post(
  "/verify-documents",
  upload.fields([
    { name: "aadhaar_file", maxCount: 1 },
    { name: "license_file", maxCount: 1 }
  ]),
  async (req, res) => {

    try {

      const { email, aadhaar_number } = req.body;

      if (!email || !aadhaar_number) {
        return res.status(400).json({ error: "Missing fields" });
      }

      if (!req.files?.aadhaar_file || !req.files?.license_file) {
        return res.status(400).json({ error: "Documents required" });
      }

      const aadhaarFile = req.files.aadhaar_file[0].filename;
      const licenseFile = req.files.license_file[0].filename;

      /* ================= SAVE TO DB ================= */

      const result = await pool.query(
        `
        UPDATE service_providers
        SET
          aadhaar_image_path = $1,
          dl_image_path = $2,
          aadhaar_verified = false,
          is_verified = false
        WHERE email = $3
        RETURNING id
        `,
        [
          aadhaarFile,
          licenseFile,
          email
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Worker not found" });
      }

      res.json({ message: "Verification submitted" });

    } catch (err) {

      console.error(err);

      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: "Upload failed" });
    }
  }
);

module.exports = router;
