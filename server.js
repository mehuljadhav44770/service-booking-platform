require("dotenv").config(); // load .env variables
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require("connect-pg-simple")(session);
const crypto = require("crypto");
const razorpay = require("./razorpay");


// Import your email helper
const sendEmail = require("./email");

const path = require("path"); 

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ CORS setup for multiple origins
// include localhost:3000 so requests from pages served by this server are allowed
const allowedOrigins = ['http://127.0.0.1:5500', 'http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:5500','https://fixofix-service-booking-platform.onrender.com' ]; // your frontend

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // send cookies/session
}));

// ✅ Session setup
app.use(session({
  store: new pgSession({
    pool: pool,                // using your existing PostgreSQL pool
    tableName: "user_sessions" // session table
  }),

  name: "fixofix.sid",
  secret: 'my_very_long_random_secret_key_1234567890',
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60
  }
}));




// For uploaded documents
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// For frontend (if served from backend)

app.use(express.static(path.join(__dirname, )));


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname,  "customer", "index.html"));
});




/* ================= ROUTES ================= */

// Verification routes (Email OTP + Upload)
const verificationRoutes = require("./verificationRoutes");
app.use("/", verificationRoutes);


/* ================= TEST ROUTE ================= */

app.get("/", (req, res) => {
  res.send("FixoFix Backend Running ✅");
});


// ✅ Route: Register a user (with password hashing and email check)
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, address, role } = req.body;

    // Check if email already exists
    const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, phone, address, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, hashedPassword, phone, address, role]
    );

     const newUser = result.rows[0];

    // 4️⃣ Send welcome email
try {
  await sendEmail(
    newUser.email,
    "🎉 Welcome to FixoFix!",
    `Hi ${newUser.name}, welcome to FixoFix!`,
    `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#333;">
      <h2 style="color:#2c3e50;">Welcome to FixoFix, ${newUser.name}!</h2>
      <p>We’re excited to have you on board.</p>
      <a href="http://localhost:3000/login.html">CLICK ME</a>
    </div>
    `
  );

  console.log("✅ Welcome email sent to:", newUser.email);

} catch (emailError) {
  console.error("❌ Email failed:", emailError.message);
}


    // 5️⃣ Respond success
    res.status(201).json({ 
      message: 'User registered successfully, welcome email sent',
      user: newUser
    });

  } catch (error) {
    console.error('❌ Error during user registration:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
app.post('/Login', async (req, res) => {

  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // ✅ SAVE SESSION
    req.session.customerId = user.id;
    
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }
      
      // 🔍 DEBUG - After session is saved
      console.log('✅ Session saved successfully');
      console.log('Session ID:', req.sessionID);
      console.log('Session data:', req.session);
      console.log('Cookies:', res.getHeaders()['set-cookie']);
      
      res.json({
        success: true,
        message: "Login success",
        id: user.id,
        sessionId: req.sessionID
      });
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---- Create booking ----
app.post('/bookings', async (req, res) => {
  try {
    // 1️⃣ Get customer ID from session
    const customerId = req.session.customerId;

    if (!customerId) {
      return res.status(401).json({ error: 'Unauthorized: Please log in first.' });
    }

    // 2️⃣ Destructure booking data from request body
    const { name, phone, address, service, preferred_date, preferred_time } = req.body;

    // 3️⃣ Basic validation
    if (!name || !phone || !address || !service || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (phone.length !== 10 || isNaN(phone)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    // 4️⃣ Insert booking into database
    const result = await pool.query(
      `INSERT INTO bookings
        (name, phone, address, service, preferred_date, preferred_time, customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, phone, address, service, preferred_date, preferred_time, customerId]
    );

    // 5️⃣ Return success
    res.status(201).json({
      message: 'Booking created successfully!',
      booking: result.rows[0]
    });

  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ error: 'Server error. Could not create booking.' });
  }
});



// GET /latest-booking - from bookings table
app.get('/latest-booking', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bookings ORDER BY id DESC LIMIT 1');
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get booking' });
  }
});

app.get('/latest-booking-with-worker', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.id AS booking_id,
        b.name AS customer_name,
        b.phone AS customer_phone,
        b.address,
        b.service,
        b.preferred_date,
        b.preferred_time,
        COALESCE(con.status, 'pending') AS booking_status,
        sp.name AS worker_name,
        sp.phone AS worker_phone,
        con.otp AS worker_otp
      FROM bookings b
      LEFT JOIN connections con ON con.booking_id = b.id AND con.status = 'accepted'
      LEFT JOIN service_providers sp ON con.provider_id = sp.id
      ORDER BY b.id DESC
      LIMIT 1
    `);

    if (!rows[0]) return res.json(null);

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch latest booking with worker' });
  }
});



// Register Worker
// Register Worker

// Worker Registration
app.post('/register-worker', async (req, res) => {
  try {
    const { name, email, password, phone, category_id, experience, location } = req.body;

    // 1️⃣ Check if email already exists
    const checkWorker = await pool.query(
      'SELECT * FROM service_providers WHERE LOWER(email) = LOWER($1)', 
      [email]
    );
    if (checkWorker.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3️⃣ Insert into DB with available = false
    const result = await pool.query(
      `INSERT INTO service_providers 
        (name, email, phone, category_id, experience, location, password_hash, available) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING *`,
      [name, email, phone, category_id, experience, location, hashedPassword]
    );

    const newWorker = result.rows[0];

    // 4️⃣ Send welcome email to the worker
    await sendEmail(
      newWorker.email,
      "👷 Welcome to FixoFix Workforce!",
      `Hi ${newWorker.name}, welcome to FixoFix as a service provider!`,
      `
      <div style="font-family: Arial, sans-serif; line-height:1.6; color:#333;">
        <h2 style="color:#2c3e50;">Welcome aboard, ${newWorker.name}!</h2>
        <p>
          We’re glad to have you join our trusted workforce. With FixoFix, 
          you’ll be able to receive customer bookings for <b>${newWorker.category_id}</b> services in your area.
        </p>
        <p>
          ✅ Verified customers<br/>
          ✅ Fair job assignments<br/>
          ✅ Easy payment tracking
        </p>
        <p>
          Login to your dashboard and set your availability to <b>Online</b> to start receiving jobs.
        </p>
        <a href="https://fixofix-service-booking-platform.onrender.com/worker-login.html">Go to Worker Login</a>
        <hr/>
        <p style="font-size:12px; color:#888;">
          This is an automated message. Please do not reply.
        </p>
      </div>
      `
    );

    // 5️⃣ Respond success
    res.status(201).json({ 
      message: 'Worker registered successfully, welcome email sent',
      worker: newWorker
    });

  } catch (error) {
    console.error('❌ Error during worker registration:', error);
    res.status(500).json({ error: 'Worker registration failed' });
  }
});

// GET /check-worker?email=...
app.get('/check-worker', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await pool.query(
      'SELECT is_verified FROM service_providers WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      // Worker does not exist → first-time registration
      return res.json({ exists: false });
    }

    const worker = result.rows[0];

    // Worker exists, return verification status
    res.json({ exists: true, is_verified: worker.is_verified });
  } catch (error) {
    console.error('❌ Error checking worker:', error);
    res.status(500).json({ error: 'Failed to check worker' });
  }
});

// POST /verify-aadhaar
app.post('/verify-aadhaar', async (req, res) => {
  try {
    const { email, aadhaar_number } = req.body;

    if (!email || !aadhaar_number) {
      return res.status(400).json({ error: "Email and Aadhaar number are required." });
    }

    // ✅ Extract last 4 digits only (legal & safe)
    const aadhaarLast4 = aadhaar_number.slice(-4);

    const query = `
      UPDATE service_providers
      SET 
        aadhaar_verified = true,
        is_verified = true,
        aadhaar_last4 = $1,
        aadhaar_verified_at = NOW()
      WHERE email = $2
      RETURNING id, email, aadhaar_last4, aadhaar_verified;
    `;

    const values = [aadhaarLast4, email];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Worker not found." });
    }

    res.json({
      message: "Aadhaar verification submitted successfully",
      worker: result.rows[0]
    });

  } catch (err) {
    console.error("VERIFY AADHAAR ERROR:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


app.listen(3000, () => {
  console.log('Server running on port 3000');
});

// Worker Login
// ✅ UPDATED LOGIN WORKER (Paste this version)
app.post('/login-worker', async (req, res) => {
  const { email, password } = req.body;

  try {

    const result = await pool.query(
      'SELECT * FROM service_providers WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const worker = result.rows[0];

    const isMatch = await bcrypt.compare(password, worker.password_hash);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // ✅ SAVE SESSION (MISSING PART)
   // ✅ SAVE SESSION
req.session.providerId = worker.id;
req.session.providerEmail = worker.email;

// 👇 FORCE SAVE SESSION
req.session.save(() => {
  console.log("✅ Session saved:", req.session);
});




    // ✅ Reset availability
    await pool.query(
      'UPDATE service_providers SET available = false WHERE id = $1',
      [worker.id]
    );

    // Reload
    const updated = await pool.query(
      'SELECT * FROM service_providers WHERE id = $1',
      [worker.id]
    );

    const workerData = updated.rows[0];
    const { password_hash, ...safeWorker } = workerData;

    // Check verification
    if (!workerData.is_verified) {

      return res.json({
        success: true,
        message: 'Aadhaar verification pending',
        redirect: 'worker-verification.html'
      });
    }

    // Success
    res.json({
      success: true,
      message: 'Login successful',
      redirect: 'worker-home.html',
      worker: safeWorker
    });

  } catch (err) {
    console.error('Worker login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// worker logout 
app.post('/logout-worker', async (req, res) => {
  const { email } = req.body;

  try {
    // Set available = false on logout
    await pool.query('UPDATE service_providers SET available = false WHERE email = $1', [email]);

    res.status(200).json({ message: 'Logout successful. Worker set to offline.' });
  } catch (err) {
    console.error('Error during worker logout:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ✅ Route: Insert Payment
app.post('/platform-fee', async (req, res) => {
  const { booking_id, amount, method } = req.body;

  try {
    await pool.query(`
      INSERT INTO platform_fees
      (booking_id, amount, payment_method, status)
      VALUES ($1, $2, $3, 'paid')
    `, [booking_id, amount, method]);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Platform fee failed' });
  }
});


// ✅ Dashboard API
// app.get('/api/dashboard/:customerId', async (req, res) => {
//   const { customerId } = req.params;

//   try {
//     const query = `
//       SELECT 
//         b.id AS booking_id, b.name AS customer_name, b.phone AS customer_phone,
//         b.address AS customer_address, b.service, b.preferred_date, b.preferred_time,
//         sp.name AS worker_name, sp.phone AS worker_phone, sp.location AS worker_address,
//         sp.rating AS worker_rating, sp.reviews AS worker_reviews,
//         sp.specialties
//       FROM bookings b
//       LEFT JOIN connections c ON c.booking_id = b.id
//       LEFT JOIN service_providers sp ON c.provider_id = sp.id
//       WHERE b.customer_id = $1
//       ORDER BY b.id DESC
//       LIMIT 1;
//     `;

//     const { rows } = await pool.query(query, [customerId]);

//     if (rows.length === 0) {
//       return res.status(404).json({ message: 'No booking found' });
//     }

//     const row = rows[0];

//     res.json({
//       booking: {
//         booking_id: row.booking_id,
//         name: row.customer_name,
//         phone: row.customer_phone,
//         address: row.customer_address,
//         service: row.service,
//         date: row.preferred_date,
//         time: row.preferred_time
//       },
//       worker: row.worker_name
//         ? {
//             phone: row.worker_phone,
//             address: row.worker_address,
//             rating: row.worker_rating,
//             reviews: row.worker_reviews,
//             specialties: row.worker_specialties ? row.worker_specialties.split(',') : []
//           }
//         : null
//     });
//   } catch (err) {
//     console.error('Error loading dashboard:', err);
//     res.status(500).json({ error: 'Internal server error' });
        charge_status = 'paid_cash',
// });

// Get workers for Active Workers page
app.get('/api/workers', async (req, res) => {
  try {
    const query = `
      SELECT 
        sp.id, 
        sp.name, 
        sp.email, 
        sp.phone, 
        sp.location, 
        COALESCE(sp.available, false) AS available,
        c.name AS service
      FROM service_providers sp
      LEFT JOIN categories c ON sp.category_id = c.id;
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching workers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// API to fetch all users
// API to fetch all users (recent first)
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, address, role, created_at FROM users ORDER BY created_at DESC NULLS LAST"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
}); 





// ✅ Get worker status
// ✅ Get worker status (for initial load)
app.get('/worker/status', async (req, res) => {
  const { email } = req.query;

  try {
    const query = `
      SELECT available 
      FROM service_providers 
      WHERE LOWER(email) = LOWER($1)
    `;
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ worker: result.rows[0] });
  } catch (err) {
    console.error('Error fetching worker status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Update worker availability
app.put('/worker/availability', async (req, res) => {
  const { email, available } = req.body;
  console.log('Request body:', req.body);

  try {
    const query = `
      UPDATE service_providers
      SET available = $1
      WHERE LOWER(email) = LOWER($2)
      RETURNING *
    `;
    const result = await pool.query(query, [available, email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ worker: result.rows[0] });
  } catch (err) {
    console.error('Error updating availability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// get booking details in customer request card
app.get('/api/bookings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Bookings ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Create booking and send notification (works for both online & offline workers)
app.post("/create-booking", async (req, res) => {
    try {
        const { booking_id, worker_id, message } = req.body;

        // Store notification in DB
        await pool.query(
            "INSERT INTO notifications (worker_id, booking_id, message) VALUES ($1, $2, $3)",
            [worker_id, booking_id, message]
        );

        res.json({ message: "Booking created and notification sent to worker" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

/* ===========================
   SEND NOTIFICATION TO WORKER
=========================== */
app.post('/send-notification', async (req, res) => {
  try {
    const { workerEmail, message } = req.body;

    // Ensure worker exists
    const workerCheck = await pool.query(
      'SELECT id FROM service_providers WHERE email = $1',
      [workerEmail]
    );

    if (workerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    const workerId = workerCheck.rows[0].id;

    // Insert notification
    await pool.query(
      'INSERT INTO notifications (worker_id, message, status) VALUES ($1, $2, $3)',
      [workerId, message, 'unread']
    );

    res.json({ success: true, message: 'Notification sent successfully' });
  } catch (err) {
    console.error('Error sending notification:', err);
    res.status(500).json({ success: false, message: 'Error sending notification' });
  }
});

/* ===========================
   GET NOTIFICATIONS FOR WORKER
=========================== */
app.get('/notifications/:workerEmail', async (req, res) => {
  try {
    const { workerEmail } = req.params;

    const workerCheck = await pool.query(
      'SELECT id FROM service_providers WHERE email = $1',
      [workerEmail]
    );

    if (workerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    const workerId = workerCheck.rows[0].id;

    const notifications = await pool.query(
      'SELECT * FROM notifications WHERE worker_id = $1 ORDER BY created_at DESC',
      [workerId]
    );

    res.json({ success: true, notifications: notifications.rows });
  } catch (err) {
    console.error('Error getting notifications:', err);
    res.status(500).json({ success: false, message: 'Error getting notifications' });
  }
});


// Admin Login
// Admin Login (auto-create if not exists)
// Admin Login (create admin if not exists)
// Admin Login
app.post('/login-admin', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Fetch user from database
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const admin = result.rows[0];

    // Compare entered password with hashed password
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Check that the user is actually an admin
    if (admin.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    // Remove password hash from response
    const { password_hash, ...adminWithoutPassword } = admin;

    res.status(200).json({
      message: 'Admin login successful',
      admin: adminWithoutPassword
    });

  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign Worker to Booking (Insert into connections)
app.post('/api/assign-worker-to-customer', async (req, res) => {
  console.log('Request body:', req.body);

  try {
    const { workerId, bookingId } = req.body;

    if (!workerId || !bookingId) {
      return res.status(400).json({ error: 'Missing workerId or bookingId' });
    }

    // 1️⃣ Fetch customer_id from bookings table
    const bookingResult = await pool.query(
      'SELECT customer_id FROM bookings WHERE id = $1',
      [bookingId]
    );

    if (bookingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const customerId = bookingResult.rows[0].customer_id;

    // 2️⃣ Insert into connections table
    const query = `
      INSERT INTO connections (customer_id, provider_id, booking_id, status, platform_fee)
      VALUES ($1, $2, $3, 'pending', 129.00)
      RETURNING *;
    `;

    const values = [customerId, workerId, bookingId];
    const result = await pool.query(query, values);

    return res.status(201).json({
      message: "Worker assigned to booking successfully.",
      connection: result.rows[0]
    });

  } catch (err) {
    console.error("Error assigning worker:", err);
    return res.status(500).json({ error: "Failed to assign worker" });
  }
});




// Get all bookings assigned to a specific worker
app.get('/api/worker-notifications/:workerId', async (req, res) => {
  const { workerId } = req.params;

  try {
    const query = `
      SELECT 
        c.id AS connection_id,
        c.status,
        b.id AS booking_id,
        b.customer_id,
        b.name AS customer_name,
        b.phone,
        b.address,
        b.service,
        b.preferred_date,
        b.preferred_time
      FROM connections c
      JOIN bookings b ON b.id = c.booking_id
      WHERE c.provider_id = $1
      ORDER BY c.id DESC
    `;
    const result = await pool.query(query, [workerId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching worker bookings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/update-connection-status/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const updateQuery = `UPDATE connections SET status=$1 WHERE id=$2 RETURNING *`;
    const result = await pool.query(updateQuery, [status, connectionId]);

    res.json({ message: `Booking ${status} successfully.`, connection: result.rows[0] });
  } catch (err) {
    console.error('Error updating booking status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/worker-pending-bookings/:workerId', async (req, res) => {
  const { workerId } = req.params;
  try {
    const query = `
      SELECT 
        c.id AS connection_id,
        b.id AS booking_id,
        b.customer_id,
        b.name AS customer_name,
        b.address,
        b.service,
        b.preferred_date AS date,
        b.preferred_time AS time,
        c.status
      FROM connections c
      JOIN bookings b ON b.id = c.booking_id
      WHERE c.provider_id = $1 AND c.status='accepted'
      ORDER BY c.id DESC
    `;
    const result = await pool.query(query, [workerId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending bookings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/save-otp
app.post('/api/save-otp', async (req, res) => {
  const { booking_id, provider_id, otp } = req.body;

  try {
    const result = await pool.query(
      `UPDATE connections
       SET otp = $1
       WHERE booking_id = $2 AND provider_id = $3
       RETURNING *`,
      [otp, booking_id, provider_id]
    );

    if (result.rowCount > 0) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'No matching booking found' });
    }
  } catch (err) {
    console.error('Database error while saving OTP:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});
// fetch into customer dashboard

app.get('/api/customer-booking/:bookingId/worker', async (req, res) => {
  const { bookingId } = req.params;
  const customerId = req.session.customer_id;

  try {
    const result = await pool.query(
      `SELECT sp.id, sp.name, sp.phone, sp.email, sp.experience, sp.location, c.status
       FROM service_providers sp
       JOIN connections c ON sp.id = c.provider_id
       WHERE c.customer_id = $1
         AND c.booking_id = $2
         AND c.status = 'accepted'`,
      [customerId, bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Worker not assigned yet' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch worker' });
  }
});




// GET all registered workers in descending order in registered worker page
app.get('/registered-workers', async (req, res) => {
  try {
    const query = `
      SELECT sp.id,
             sp.name,
             sp.phone,
             sp.email,
             c.name AS service,
             sp.experience,
             sp.location AS city,
             sp.available AS active
      FROM service_providers sp
      LEFT JOIN categories c ON sp.category_id = c.id
      ORDER BY sp.id DESC
    `;

    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching registered workers:', err);
    res.status(500).json({ error: 'Failed to fetch workers' });
  }
});


app.get('/api/rejected-bookings', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id AS connection_id,
        c.provider_id AS worker_id,
        sp.name AS worker_name,
        b.id AS booking_id,
        b.name AS customer_name,
        b.service,
        b.address,
        b.preferred_date AS date,
        b.preferred_time AS time
      FROM connections c
      JOIN bookings b ON c.booking_id = b.id
      JOIN service_providers sp ON c.provider_id = sp.id
      WHERE c.status = 'rejected'
      ORDER BY c.id DESC;
    `;

    const { rows } = await pool.query(query);

    console.log("✅ Rows returned from DB:", rows); // <-- debug log

    if (!rows || rows.length === 0) {
      return res.json([]);
    }

    res.json(rows);

  } catch (err) {
    console.error("❌ Error fetching rejected bookings:", err);
    res.status(500).json({ error: 'Failed to fetch rejected bookings', details: err.message });
  }
});





// 2️⃣ Fetch eligible workers for reassignment
//    Exclude rejected worker, must be online, same service & location
// Exclude rejected worker, must be online, same service & location
app.get('/api/eligible-workers', async (req, res) => {
  const { service, location, excludeId } = req.query;

  if (!service || !location || !excludeId) {
    return res.status(400).json({ error: 'Missing query parameters' });
  }

  try {
    const query = `
      SELECT sp.id, sp.name, sp.email, sp.phone, sp.experience, sp.location, c.name AS category_name
      FROM service_providers sp
      LEFT JOIN categories c ON sp.category_id = c.id
      WHERE sp.available = true
        AND sp.id <> $1
        AND c.name = $2
        AND sp.location = $3
    `;
    const values = [excludeId, service, location];
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching eligible workers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// 3️⃣ Reassign booking to new worker
app.put('/api/reassign-booking/:bookingId', async (req, res) => {
  const { bookingId } = req.params;
  const { newWorkerId } = req.body;

  if (!newWorkerId) {
    return res.status(400).json({ error: 'Missing new worker ID' });
  }

  try {
    // Update connection with new worker
    const query = `
      UPDATE connections
      SET provider_id = $1,
          status = 'pending',
          order_at = CURRENT_TIMESTAMP
      WHERE booking_id = $2
    `;
    await pool.query(query, [newWorkerId, bookingId]);

    res.json({ message: 'Booking reassigned successfully!' });
  } catch (err) {
    console.error('Error reassigning booking:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /api/admin-active-bookings
app.get('/api/admin-active-bookings', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id AS connection_id,
        u.id AS customer_id,
        u.name AS customer_name,
        sp.id AS worker_id,
        sp.name AS worker_name,
        b.id AS booking_id,
        b.service,
        b.preferred_date,
        b.preferred_time,
        b.address,
        c.status
      FROM connections c
      INNER JOIN bookings b ON c.booking_id = b.id
      INNER JOIN users u ON c.customer_id = u.id
      INNER JOIN service_providers sp ON c.provider_id = sp.id
      WHERE c.status = 'accepted'
      ORDER BY c.id DESC;
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching active bookings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// POST /api/submit-charge
// POST /api/submit-charge
app.post('/api/submit-charge', async (req, res) => {
  const { connection_id, amount, note, payment_method } = req.body; // payment_method optional

  console.log('[/api/submit-charge] payload:', { connection_id, amount, note, payment_method });

  const parsedAmount = parseFloat(amount);
  if (!connection_id || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid data' });
  }

  try {
const chargeStatus = 'requested';

    const updateQuery = `
      UPDATE connections
      SET service_charge = $1,
          charge_status = $2,
          reached_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *;
    `;

    const { rows } = await pool.query(updateQuery, [parsedAmount, chargeStatus, connection_id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    res.json({ success: true, connection: rows[0] });
  } catch (err) {
    console.error('Error submitting charge:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});




// GET /api/customer/final-bill
// ================= Final Bill API =================
// GET final bill for a booking by booking_id
// ✅ Final Bill API (safe, with console logging)
app.get('/api/customer/final-bill/:booking_id', async (req, res) => {
  const bookingId = req.params.booking_id;

  try {
    if (!bookingId) {
      console.warn("[final-bill] Missing booking_id");
      return res.status(400).json({ error: "Missing booking_id" });
    }

    const result = await pool.query(`
      SELECT 
        c.id AS connection_id,
        c.service_charge,
        c.charge_status,
        c.otp,
        COALESCE(sp.name, 'Not Assigned') AS worker_name,
        COALESCE(sp.phone, '') AS worker_phone,
        COALESCE(b.service, 'Unknown') AS service_name
      FROM connections c
      LEFT JOIN service_providers sp ON c.provider_id = sp.id
      LEFT JOIN bookings b ON c.booking_id = b.id
      WHERE c.booking_id = $1
      LIMIT 1
    `, [bookingId]);

    if (!result.rows.length) {
      console.log(`[final-bill] No connection found for booking_id=${bookingId}`);
      return res.json({ hasCharge: false });
    }

    const bill = result.rows[0];

    res.json({
      hasCharge: bill.service_charge != null,
      bill: {
        connection_id: bill.connection_id,
        service_charge: bill.service_charge || 0,
        charge_status: bill.charge_status || "none",
        otp: bill.otp || null,
        worker_name: bill.worker_name,
        worker_phone: bill.worker_phone,
        service_name: bill.service_name
      }
    });

  } catch (err) {
    console.error("[final-bill] Internal Server Error:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// ===================== Worker submits negotiation range =====================
// ================= SUBMIT NEGOTIATION =================
// ================== SUBMIT NEGOTIATION RANGE ==================
// app.post('/api/submit-negotiation', async (req, res) => {
//   const { connection_id, min_charge, max_charge } = req.body;

//   console.log('[/api/submit-negotiation] payload:', { connection_id, min_charge, max_charge });

//   const parsedMin = parseFloat(min_charge);
//   const parsedMax = parseFloat(max_charge);

//   if (!connection_id || isNaN(parsedMin) || isNaN(parsedMax) || parsedMin <= 0 || parsedMax <= 0 || parsedMin > parsedMax) {
//     return res.status(400).json({ success: false, message: 'Invalid data' });
//   }

//   try {
//     // 🔹 Get worker_id and booking_id from the connection
//     const connQuery = `SELECT worker_id AS provider_id, booking_id FROM connections WHERE id = $1`;
//     const connRes = await pool.query(connQuery, [connection_id]);

//     if (connRes.rows.length === 0) {
//       return res.status(404).json({ success: false, message: 'Connection not found' });
//     }

//     const { provider_id, booking_id } = connRes.rows[0];

//     // 🔹 Insert into negotiations
//     const insertQuery = `
//       INSERT INTO negotiations (connection_id, booking_id, worker_id, min_charge, max_charge)
//       VALUES ($1, $2, $3, $4, $5)
//       RETURNING *;
//     `;

//     const { rows } = await pool.query(insertQuery, [connection_id, booking_id, provider_id, parsedMin, parsedMax]);

//     res.json({ success: true, negotiation: rows[0] });
//   } catch (err) {
//     console.error('Error submitting negotiation:', err);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// });






app.post('/api/submit-negotiation', async (req, res) => {
  try {
    const {
      booking_id,
      worker_id,
      connection_id,
      min_charge,
      max_charge
    } = req.body;

    // Validation
    if (!booking_id || !worker_id || !min_charge || !max_charge) {
      return res.json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const query = `
      INSERT INTO negotiations
      (booking_id, worker_id, connection_id, min_charge, max_charge, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;

    const result = await pool.query(query, [
      booking_id,
      worker_id,
      connection_id,
      min_charge,
      max_charge
    ]);

    res.json({
      success: true,
      message: 'Negotiation saved',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('Negotiation Error:', err && err.stack ? err.stack : err);

    res.status(500).json({
      success: false,
      message: err && err.message ? err.message : 'Server error'
    });
  }
});


app.get('/api/customer/latest-negotiation', async (req, res) => {
  // Allow booking_id via query param (fallback to session) so frontend can request for a specific booking
  const bookingId = req.query.booking_id || req.session.latest_booking_id;
  if (!bookingId) return res.json({ exists: false, message: 'Booking ID required' });

  try {
    const result = await pool.query(`
      SELECT n.*, sp.name AS worker_name
      FROM negotiations n
      LEFT JOIN service_providers sp ON n.worker_id = sp.id
      WHERE n.booking_id = $1
      ORDER BY n.created_at DESC
      LIMIT 1
    `, [bookingId]);

    if (result.rows.length === 0) return res.json({ exists: false });

    const negotiation = result.rows[0];
    res.json({ exists: true, negotiation });
  } catch (err) {
    console.error('Error fetching latest negotiation:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});


// POST accept negotiation
app.post('/api/customer/accept-negotiation', async (req, res) => {
  const { booking_id } = req.body;

  if (!booking_id) return res.status(400).json({ success: false, message: 'Booking ID required' });

  try {
    // Fetch latest negotiation for this booking
    const result = await pool.query(`
      SELECT negotiation_id, min_charge, max_charge
      FROM negotiations
      WHERE booking_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [booking_id]);

    if (result.rows.length === 0) 
      return res.json({ success: false, message: 'No negotiation found' });

    const negotiation = result.rows[0];

    // Update negotiation as accepted, set agreed_charge as max_charge (you can change logic if needed)
    await pool.query(`
      UPDATE negotiations
      SET status = 'accepted',
          agreed_charge = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE negotiation_id = $2
    `, [negotiation.max_charge, negotiation.negotiation_id]);

    res.json({ success: true, message: `Negotiation accepted at ₹${negotiation.max_charge}` });

  } catch (err) {
    console.error('Error accepting negotiation:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// POST customer counter offer (attach counter & notes to latest negotiation)
app.post('/api/customer/submit-counter', async (req, res) => {
  try {
    const { booking_id, counter, notes } = req.body;

    if (!booking_id || !counter) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Get the latest negotiation for this booking
    const result = await pool.query(`
      SELECT negotiation_id FROM negotiations
      WHERE booking_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [booking_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No negotiation found for this booking' });
    }

    const negotiationId = result.rows[0].negotiation_id;

    // Update negotiation with customer's counter
    await pool.query(`
      UPDATE negotiations
      SET customer_counter = $1,
          customer_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE negotiation_id = $3
    `, [counter, notes || null, negotiationId]);

    res.json({ success: true, message: 'Counter offer saved' });

  } catch (err) {
    console.error('Error submitting customer counter:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// GET latest customer counter for worker
// Get latest customer counter for worker
app.get('/api/worker/latest-counter', async (req, res) => {
  try {
    const { connection_id } = req.query;

    if (!connection_id) {
      return res.json({ exists: false });
    }

    const result = await pool.query(`
      SELECT
        n.customer_counter,
        n.customer_notes,
        n.updated_at,
        n.min_charge,
        n.max_charge,
        n.agreed_charge,
        n.status,
        b.id AS booking_id
      FROM negotiations n
      JOIN bookings b ON b.id = n.booking_id
      WHERE n.connection_id = $1
      ORDER BY n.updated_at DESC
      LIMIT 1
    `, [connection_id]);

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      offer: result.rows[0]
    });

  } catch (err) {
    console.error('LATEST COUNTER ERROR:', err);
    res.status(500).json({
      exists: false,
      error: err.message
    });
  }
});

app.get('/admin/inspection-fees', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        pf.id,
        pf.booking_id,
        pf.amount,
        pf.payment_method,
        pf.gateway,
        pf.transaction_id,
        pf.status,
        pf.paid_at,

        b.name    AS customer_name,
        b.service

      FROM platform_fees pf
      JOIN bookings b 
        ON b.id = pf.booking_id

      WHERE pf.status = 'paid'

      ORDER BY pf.paid_at DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Inspection fetch failed" });
  }
});



// Get total admin wallet (platform fees)
// ✅ Get total admin wallet (platform fees)
app.get('/admin/total-inspection-fees', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(amount), 0) AS total
      FROM platform_fees
      WHERE status = 'paid'
    `);

    res.json({
      total: result.rows[0].total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});



app.post('/api/payment/save', async (req, res) => {

  const {
    booking_id,
    connection_id,
    payment_mode,     // 'online' | 'cash'
    transaction_id
  } = req.body;

  if (!booking_id || !connection_id || !payment_mode) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }

  if (!['online', 'cash'].includes(payment_mode)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment mode'
    });
  }

  try {

    // ==============================
    // 1. Get final charge FIRST
    // ==============================
    const chargeResult = await pool.query(
      `SELECT service_charge FROM connections WHERE id = $1`,
      [connection_id]
    );

    if (chargeResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const finalCharge = Number(chargeResult.rows[0].service_charge);

    if (!finalCharge || finalCharge <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service charge'
      });
    }

    // ==============================
    // 2. Check if already paid
    // ==============================
    const alreadyPaid = await pool.query(
      `SELECT id FROM payments WHERE booking_id = $1`,
      [booking_id]
    );

    // ==============================
    // 3. If exists → UPDATE
    // ==============================
    if (alreadyPaid.rowCount > 0) {

      const update = await pool.query(`
        UPDATE payments
        SET
          final_charge = $1,
          payment_mode = $2,
          transaction_id = $3,
          gateway = $4,
          payment_status = 'paid',
          paid_at = NOW()
        WHERE booking_id = $5
        RETURNING *;
      `, [
        finalCharge,
        payment_mode,
        transaction_id || null,
        payment_mode === 'online' ? 'razorpay' : 'cash',
        booking_id
      ]);

      return res.json({
        success: true,
        message: 'Payment updated',
        payment: update.rows[0]
      });
    }

    // ==============================
    // 4. INSERT new payment
    // ==============================
    const insert = await pool.query(`
      INSERT INTO payments (
        booking_id,
        final_charge,
        payment_mode,
        payment_status,
        transaction_id,
        gateway,
        provider_amount,
        paid_at
      )
      VALUES ($1,$2,$3,'paid',$4,$5,$6,NOW())
      RETURNING *;
    `, [
      booking_id,
      finalCharge,
      payment_mode,
      transaction_id || null,
      payment_mode === 'online' ? 'razorpay' : 'cash',
      finalCharge
    ]);

    // ==============================
    // 5. Success
    // ==============================
    res.json({
      success: true,
      message: 'Payment saved successfully',
      payment: insert.rows[0]
    });

  } catch (err) {

    console.error('PAYMENT SAVE ERROR:', err);

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }

});

// CASH PAYMENTS
app.get('/admin/cash-payments', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT DISTINCT
        p.id AS payment_id,
        p.final_charge,
        p.provider_amount,
        p.payment_status,
        p.paid_at,

        b.service,

         b.name AS customer_name,
        b.customer_id,

        sp.name AS provider_name,
        sp.id AS provider_id

      FROM payments p

      JOIN bookings b 
        ON p.booking_id = b.id

      JOIN users u 
        ON b.customer_id = u.id   -- ✅ booking owner

      LEFT JOIN connections c 
        ON c.booking_id = b.id

      LEFT JOIN service_providers sp 
        ON c.provider_id = sp.id

      WHERE p.payment_mode = 'cash'
        AND p.payment_status = 'paid'
        AND p.final_charge > 0

      ORDER BY p.paid_at DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cash fetch failed" });
  }
});



// ONLINE PAYMENTS
app.get('/admin/online-payments', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT DISTINCT
        p.id AS payment_id,
        p.final_charge,
        p.payment_status,
        p.paid_at,

        COALESCE(pf.amount, 0) AS platform_fee,

        b.service,

        b.name AS customer_name,
        b.customer_id,

        sp.name AS provider_name,
        sp.id AS provider_id

      FROM payments p

      JOIN bookings b 
        ON p.booking_id = b.id

      JOIN users u 
        ON b.customer_id = u.id   -- ✅ booking owner

      LEFT JOIN connections c 
        ON c.booking_id = b.id

      LEFT JOIN service_providers sp 
        ON c.provider_id = sp.id

      LEFT JOIN platform_fees pf
        ON pf.booking_id = p.booking_id
       AND pf.status = 'paid'

      WHERE p.payment_mode = 'online'
        AND p.payment_status = 'paid'
        AND p.final_charge > 0

      ORDER BY p.paid_at DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Online fetch failed" });
  }
});



// app.get('/admin/inspection-total', async (req, res) => {
//   try {

//     const result = await pool.query(`
//       SELECT 
//         COALESCE(SUM(amount),0) AS total_inspection
//       FROM platform_fees
//       WHERE status = 'paid'
//     `);

//     res.json(result.rows[0]);

//   } catch (err) {
//     res.status(500).json({ error: "Inspection total error" });
//   }
// });


app.get('/admin/cash-total', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(final_charge), 0) AS cash_total
      FROM payments
      WHERE payment_mode = 'cash'
        AND payment_status = 'paid'
        AND final_charge > 0
    `);

    res.json({
      cash_total: result.rows[0].cash_total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cash total error" });
  }
});
app.get('/admin/online-total', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(final_charge), 0) AS online_total
      FROM payments
      WHERE payment_mode = 'online'
        AND payment_status = 'paid'
        AND final_charge > 0
    `);

    res.json({
      online_total: result.rows[0].online_total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Online total error" });
  }
});
app.get('/admin/grand-total', async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT

      -- Cash
      (SELECT COALESCE(SUM(final_charge),0)
       FROM payments
       WHERE payment_mode='cash'
       AND payment_status='paid') AS cash_total,

      -- Online
      (SELECT COALESCE(SUM(final_charge),0)
       FROM payments
       WHERE payment_mode='online'
       AND payment_status='paid') AS online_total,

      -- Inspection
      (SELECT COALESCE(SUM(amount),0)
       FROM platform_fees
       WHERE status='paid') AS inspection_total
    `);

    const row = result.rows[0];

    const grandTotal =
      Number(row.cash_total) +
      Number(row.online_total) +
      Number(row.inspection_total);

    res.json({
      cash_total: row.cash_total,
      online_total: row.online_total,
      inspection_total: row.inspection_total,
      grand_total: grandTotal
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Grand total error" });
  }
});

app.get('/api/profile', async (req, res) => {

  // 🔍 DEBUG
  console.log('Profile endpoint called');
  console.log('Session ID:', req.sessionID);
  console.log('Full Session object:', JSON.stringify(req.session));
  console.log('CustomerId from session:', req.session.customerId);
  console.log('Request headers:', req.headers);
  console.log('Cookies:', req.cookies);

  // ✅ FIXED
  if (!req.session || !req.session.customerId) {
    console.log('❌ Session or customerId missing');
    return res.status(401).json({ error: 'Unauthorized - No session found', sessionID: req.sessionID });
  }

  try {

    const result = await pool.query(
      `SELECT id, name, email, phone, address, role
       FROM users
       WHERE id = $1`,
      [req.session.customerId]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/profile', async (req, res) => {

  // ✅ FIXED
  if (!req.session.customerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, phone, address } = req.body;

  try {

    await pool.query(
      `UPDATE users
       SET name = $1,
           phone = $2,
           address = $3
       WHERE id = $4`,
      [name, phone, address, req.session.customerId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});
// ===============================
// ================= WORKER WALLET =================

app.get('/api/worker/wallet', async (req, res) => {

  try {

    // 🔍 Log session
    console.log("👉 SESSION:", req.session);

    // Check login using EMAIL
    if (!req.session.providerEmail) {

      console.log("❌ UNAUTHORIZED: providerEmail missing");

      return res.status(401).json({
        error: 'Unauthorized - No Session Found'
      });
    }

    const email = req.session.providerEmail;

    console.log("✅ AUTHORIZED EMAIL:", email);

    // Run query using email
    const result = await pool.query(`
      SELECT 
        p.id,
        p.payment_mode,
        p.final_charge,
        p.provider_amount,
        p.transaction_id,
        p.paid_at,
        p.payment_status,
        b.service
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      JOIN connections c ON c.booking_id = b.id
      JOIN service_providers s ON s.id = c.worker_id
      WHERE s.email = $1
      ORDER BY p.paid_at DESC
    `, [email]);

    console.log("✅ RECORDS FOUND:", result.rowCount);

    if (result.rows.length > 0) {
      console.log("📄 SAMPLE RECORD:", result.rows[0]);
    }

    res.json(result.rows);

  } catch (err) {

    console.error("🔥 WALLET API ERROR:", err);

    res.status(500).json({
      error: 'Server error',
      details: err.message
    });
  }
});




// ================= WALLET SUMMARY =================

app.get('/api/worker/wallet-summary', async (req, res) => {

  try {

    if (!req.session.providerEmail) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const email = req.session.providerEmail;

    const result = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN p.payment_mode = 'cash' THEN p.final_charge ELSE 0 END),0) AS cash,
        COALESCE(SUM(p.provider_amount),0) AS balance
      FROM payments p
      JOIN connections c ON p.booking_id = c.booking_id
      JOIN service_providers s ON s.id = c.worker_id
      WHERE s.email = $1
    `, [email]);

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Server error' });
  }
});



// SEND EMAIL OTP
app.post("/send-email-otp", async (req, res) => {

  try {

        console.log("FULL BODY:", req.body);   // 👈 add this
    console.log("EMAIL:", req.body.email); // 👈 add this


    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await pool.query(
      "SELECT id FROM service_providers WHERE email=$1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Email not registered" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const expiry = new Date(Date.now() + 5 * 60000);

    await pool.query(`
      UPDATE service_providers
      SET email_otp=$1, otp_expiry=$2
      WHERE email=$3
    `, [otp, expiry, email]);

await sendEmail(
  email,
  "Email Verification OTP",
  `Your OTP is ${otp}`,
  `<h2>Your OTP: ${otp}</h2><p>This OTP will expire in 5 minutes.</p>`
);

    res.json({ success: true });

  } catch (err) {

    console.error("Send OTP Error:", err);

    res.status(500).json({ error: "Server error" });
  }

});



// VERIFY EMAIL OTP
app.post("/verify-email-otp", async (req, res) => {

  try {

    const { email, otp } = req.body;

    // Validate
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP required" });
    }

    // Get OTP data
    const result = await pool.query(`
      SELECT email_otp, otp_expiry
      FROM service_providers
      WHERE email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const { email_otp, otp_expiry } = result.rows[0];

    // OTP missing / used
    if (!email_otp || !otp_expiry) {
      return res.status(400).json({
        error: "OTP not found. Please resend."
      });
    }

    // Expired
    if (new Date() > new Date(otp_expiry)) {
      return res.status(400).json({
        error: "OTP expired"
      });
    }

    // Wrong OTP
    if (email_otp !== otp) {
      return res.status(400).json({
        error: "Invalid OTP"
      });
    }

    // Success → Verify
    await pool.query(`
      UPDATE service_providers
      SET 
        email_otp = NULL,
        otp_expiry = NULL,
        email_verified = true
      WHERE email = $1
    `, [email]);

    res.json({
      success: true,
      message: "Email verified successfully"
    });

  } catch (err) {

    console.error("Verify OTP Error:", err);

    res.status(500).json({
      error: "Server error"
    });
  }

});

app.post("/create-order", async (req, res) => {
  try {

    const { connection_id, amount } = req.body;

    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now()
    };

    const order = await razorpay.orders.create(options);

    // save order in database
    await pool.query(
      `INSERT INTO razorpay_transactions 
      (connection_id, razorpay_order_id, amount, payment_status)
      VALUES ($1,$2,$3,'created')`,
      [connection_id, order.id, amount]
    );

    res.json(order);

  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});




app.post("/verify-payment", async (req, res) => {
  try {

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {

      await pool.query(
        `UPDATE razorpay_transactions
         SET razorpay_payment_id=$1,
             razorpay_signature=$2,
             payment_status='success',
             paid_at=NOW()
         WHERE razorpay_order_id=$3`,
        [razorpay_payment_id, razorpay_signature, razorpay_order_id]
      );

      res.json({ status: "success" });

    } else {

      await pool.query(
        `UPDATE razorpay_transactions
         SET payment_status='failed'
         WHERE razorpay_order_id=$1`,
        [razorpay_order_id]
      );

      res.status(400).json({ status: "failed" });
    }

  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).json({ error: "Payment verification failed" });
  }
});



// Start server
app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
