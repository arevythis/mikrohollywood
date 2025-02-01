const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

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
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: "Επιβεβαίωση Ραντεβού",
    text: `Αγαπητέ/ή,\n\nΤο ραντεβού σας στις ${appointmentDate} ώρα ${appointmentTime} έχει επιβεβαιωθεί.\n\nΕυχαριστούμε!`,
    html: `<p>Αγαπητέ/ή,</p>
           <p>Το ραντεβού σας στις <strong>${appointmentDate}</strong> ώρα <strong>${appointmentTime}</strong> έχει επιβεβαιωθεί.</p>
           <p>Ευχαριστούμε!</p>`,
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

// API Routes

/** 📌 Book an appointment */
app.post("/appointments", async (req, res) => {
  const { user_id, name, phone, email, appointment_date, appointment_time } = req.body;

  if (!user_id || !name || !phone || !email || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Όλα τα πεδία είναι υποχρεωτικά." });
  }

  try {
    // Insert appointment into the database
    const result = await pool.query(
      "INSERT INTO appointments (user_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, 'pending') RETURNING *",
      [user_id, appointment_date, appointment_time]
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

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});