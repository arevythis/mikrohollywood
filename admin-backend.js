const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg'); // Assuming you're using PostgreSQL
const cron = require('node-cron'); // Import node-cron
require('dotenv').config();

const app = express();
const PORT = 5000; // Ensure this is the correct port

// Use environment variables for admin credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpassword';

// Set up the PostgreSQL connection pool using individual environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory
app.use('/img', express.static(path.join(__dirname, 'img'))); // Serve images from 'img' directory
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'img'), // Ensure this directory exists
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Admin login route
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_login.html'));
});

// Handle admin login
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt with username: ${username} and password: ${password}`);
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.admin = true;
        console.log('Login successful, redirecting to admin dashboard.');
        res.redirect('/admin');
    } else {
        console.log('Invalid credentials, sending 401 response.');
        res.status(401).send('Invalid credentials');
    }
});

// Admin dashboard route
app.get('/admin', (req, res) => {
    if (!req.session.admin) {
        console.log('Unauthorized access attempt to admin dashboard.');
        return res.redirect('/admin/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin_dashboard.html'));
});

// Logout route
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Add photo route
app.post('/admin/add_photo', upload.single('photo'), (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }
    res.redirect('/admin');
});

// Delete photo route
app.post('/admin/delete_photo', (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }
    const photoPath = path.join(__dirname, 'img', req.body.photo_id);
    if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
    }
    res.redirect('/admin');
});

// Free appointment slot route
app.post('/admin/free_appointment_slot', async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }
    const appointmentId = req.body.appointment_id;
    try {
        await pool.query(
            "DELETE FROM appointments WHERE id = $1",
            [appointmentId]
        );
        res.redirect('/admin');
    } catch (error) {
        console.error('Error deleting appointment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint to get all photos
app.get('/admin/photos', (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const photoFiles = fs.readdirSync(path.join(__dirname, 'img')).map(filename => ({
            id: filename,
            name: filename
        }));
        res.json(photoFiles);
    } catch (error) {
        console.error('Error reading img directory:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint to get all appointments
app.get('/admin/appointments', async (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const result = await pool.query("SELECT id, appointment_date, appointment_time FROM appointments");
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Endpoint to close a specific day
app.post("/admin/close_day", async (req, res) => {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Η ημερομηνία είναι υποχρεωτική.' });
    }
    try {
      await pool.query('INSERT INTO closed_days (date) VALUES ($1) ON CONFLICT DO NOTHING', [date]);
      res.status(200).json({ message: `Η ημέρα ${date} έχει κλείσει.` });
    } catch (error) {
      console.error('❌ Error closing the day:', error);
      res.status(500).json({ error: 'Αποτυχία κλεισίματος της ημέρας.' });
    }
  });

// Schedule a task to delete expired appointments every hour
cron.schedule('* * * * *', async () => {
    console.log('Running scheduled task to delete expired appointments');
    try {
        // Get current date and time
        const now = new Date();
        const currentDate = now.toISOString().split('T')[0];
        const currentTime = now.toTimeString().split(' ')[0];

        console.log('Current date:', currentDate);
        console.log('Current time:', currentTime);

        const result = await pool.query(
            "DELETE FROM appointments WHERE appointment_date < $1 OR (appointment_date = $1 AND appointment_time < $2) RETURNING *",
            [currentDate, currentTime]
        );

        console.log(`Deleted ${result.rowCount} expired appointments`);
    } catch (error) {
        console.error('Error deleting expired appointments:', error);
    }
});

app.listen(PORT, () => {
    console.log(`Admin backend server running on http://localhost:${PORT}`);
});
