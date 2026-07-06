require('dotenv').config();
const express = require('express');
const session = require('express-session');
const csrf = require('@dr.pogodin/csurf');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads', 'curriculum');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Body parsing & static files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_cybersecurity_system_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false
    }
}));

// CSRF protection
const csrfProtection = csrf({ cookie: true });
app.use(cookieParser());
app.use(csrfProtection);
app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
});

// Route modules
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const studentRoutes = require('./src/routes/student');

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/student', studentRoutes);

// Start server
app.listen(3000, () => {
    console.log('[SERVER REINITIALIZED] Live on http://localhost:3000');
});
