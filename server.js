const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// API Routes

/** 📌 Get list of images */
app.get("/img-list", (req, res) => {
  const imagesDir = path.join(__dirname, 'img');
  console.log(`Reading directory: ${imagesDir}`);
  fs.readdir(imagesDir, (err, files) => {
    if (err) {
      console.error('Unable to scan directory:', err);
      return res.status(500).send('Unable to scan directory: ' + err);
    }
    const images = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
    console.log('Images found:', images);
    res.json(images);
  });
});

// Serve static files from the "public" directory
app.use(express.static('public'));

// Serve static files from the "img" directory
app.use('/img', express.static('img'));

// PostgreSQL Connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Nodemailer Configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to send confirmation email to the user
const sendConfirmationEmail = async (to, appointmentDate, appointmentTime) => {
  const cancelUrl = `http://localhost:5000/cancel.html?email=${encodeURIComponent(to)}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: "Επιβεβαίωση Ραντεβού",
    text: `Αγαπητέ/ή,\n\nΤο ραντεβού σας στις ${appointmentDate} ώρα ${appointmentTime} έχει επιβεβαιωθεί.\n\nΕυχαριστούμε!\n\nΓια να ακυρώσετε το ραντεβού σας, επισκεφθείτε τον ακόλουθο σύνδεσμο: ${cancelUrl}`,
    html: `<p>Αγαπητέ/ή,</p>
           <p>Το ραντεβού σας στις <strong>${appointmentDate}</strong> ώρα <strong>${appointmentTime}</strong> έχει επιβεβαιωθεί.</p>
           <p>Ευχαριστούμε!</p>
           <p>Για να ακυρώσετε το ραντεβού σας, επισκεφθείτε τον ακόλουθο σύνδεσμο: <a href="${cancelUrl}">Ακύρωση Ραντεβού</a></p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Confirmation email sent to ${to}`);
  } catch (error) {
    console.error("❌ Error sending confirmation email:", error);
  }
};

// Function to send admin notification email
const sendAdminEmail = async (name, phone, appointmentDate, appointmentTime, userEmail) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: adminEmail,
    subject: "Νέο Ραντεβού Κλείστηκε",
    text: `📅 Νέο ραντεβού:\n- Όνομα: ${name}\n- Τηλέφωνο: ${phone}\n- Ημερομηνία: ${appointmentDate}\n- Ώρα: ${appointmentTime}\n- Email: ${userEmail}`,
    html: `<h3>📅 Νέο Ραντεβού</h3>
           <p><strong>Όνομα:</strong> ${name}</p>
           <p><strong>Τηλέφωνο:</strong> ${phone}</p>
           <p><strong>Ημερομηνία:</strong> ${appointmentDate}</p>
           <p><strong>Ώρα:</strong> ${appointmentTime}</p>
           <p><strong>Email:</strong> ${userEmail}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Admin notification email sent to ${adminEmail}`);
  } catch (error) {
    console.error("❌ Error sending admin notification email:", error);
  }
};

/** 📌 Book an appointment */
app.post("/appointments", async (req, res) => {
  const { user_id, name, phone, email, appointment_date, appointment_time } = req.body;

  if (!user_id || !name || !phone || !email || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Όλα τα πεδία είναι υποχρεωτικά." });
  }

  try {
    // Insert appointment into the database
    const result = await pool.query(
      "INSERT INTO appointments (user_id, appointment_date, appointment_time, email, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING *",
      [user_id, appointment_date, appointment_time, email]
    );

    console.log("✅ Appointment booked:", result.rows[0]);

    // Send confirmation email to the user
    sendConfirmationEmail(email, appointment_date, appointment_time);

    // Send admin notification email (NOW WITH NAME & PHONE)
    sendAdminEmail(name, phone, appointment_date, appointment_time, email);

    res.status(200).json({ message: "Η κράτηση καταχωρήθηκε με επιτυχία!" });
  } catch (err) {
    console.error("❌ Error while booking appointment:", err);
    res.status(500).json({ error: "Αποτυχία καταχώρησης ραντεβού." });
  }
});

/** 📌 Get booked slots for a specific date */
app.get("/booked-slots", async (req, res) => {
  const { date } = req.query;

  try {
    const result = await pool.query(
      "SELECT appointment_time FROM appointments WHERE appointment_date = $1",
      [date]
    );

    const bookedSlots = result.rows.map(row => row.appointment_time.substr(0, 5));
    res.status(200).json({ bookedSlots });
  } catch (err) {
    console.error("❌ Error fetching booked slots:", err);
    res.status(500).json({ error: "Αποτυχία λήψης των ήδη κλεισμένων ωρών." });
  }
});
/** 📌 Get appointments for a specific email */
app.get("/appointments", async (req, res) => {
  const { email } = req.query;
  const now = new Date();

  try {
    const result = await pool.query(
      "SELECT id, appointment_date, appointment_time FROM appointments WHERE email = $1 AND status = 'pending' AND (appointment_date > $2 OR (appointment_date = $2 AND appointment_time > $3))",
      [email, now.toISOString().split('T')[0], now.toTimeString().split(' ')[0].substring(0, 5)]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching appointments:", err);
    res.status(500).json({ error: "Αποτυχία λήψης των ραντεβού." });
  }
});

/** 📌 Cancel an appointment */
app.post("/cancel-appointment", async (req, res) => {
  const { id } = req.body;

  try {
    await pool.query(
      "UPDATE appointments SET status = 'cancelled' WHERE id = $1",
      [id]
    );

    res.status(200).json({ message: "Το ραντεβού ακυρώθηκε με επιτυχία!" });
  } catch (err) {
    console.error("❌ Error cancelling appointment:", err);
    res.status(500).json({ error: "Αποτυχία ακύρωσης ραντεβού." });
  }
});
// Function to send cancellation link email to the user
const sendCancellationLink = async (to) => {
  const cancelUrl = `http://localhost:5000/cancel.html?email=${encodeURIComponent(to)}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: "Σύνδεσμος Ακύρωσης Ραντεβού",
    text: `Αγαπητέ/ή,\n\nΠαρακαλώ χρησιμοποιήστε τον ακόλουθο σύνδεσμο για να ακυρώσετε το ραντεβού σας:\n\n${cancelUrl}\n\nΕυχαριστούμε!`,
    html: `<p>Αγαπητέ/ή,</p>
           <p>Παρακαλώ χρησιμοποιήστε τον ακόλουθο σύνδεσμο για να ακυρώσετε το ραντεβού σας:</p>
           <p><a href="${cancelUrl}">Ακύρωση Ραντεβού</a></p>
           <p>Ευχαριστούμε!</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Cancellation link email sent to ${to}`);
  } catch (error) {
    console.error("❌ Error sending cancellation link email:", error);
  }
};

// Endpoint to handle sending cancellation link email
app.post("/send-cancel-link", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Το email είναι υποχρεωτικό." });
  }

  try {
    await sendCancellationLink(email);
    res.status(200).json({ message: "Ο σύνδεσμος ακύρωσης στάλθηκε στο email σας." });
  } catch (error) {
    console.error("❌ Error sending cancellation link email:", error);
    res.status(500).json({ error: "Αποτυχία αποστολής του συνδέσμου ακύρωσης." });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
