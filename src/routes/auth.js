const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { redirectIfLoggedIn } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/', (req, res) => {
    res.render('public/index');
});

router.get('/login', redirectIfLoggedIn, (req, res) => {
    res.render('auth/login', { error: null });
});

router.post('/login', validate({
    username: { required: true },
    password: { required: true }
}), async (req, res) => {
    const { username, password } = req.body;
    console.log(`[AUTH LOG] Login attempt for User ID: ${username}`);

    try {
        const userQuery = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL',
            [username]
        );

        if (userQuery.rows.length === 0) {
            console.log(`[AUTH LOG] User ID "${username}" not found in database.`);
            return res.render('auth/login', { error: 'Invalid User ID or Password.' });
        }

        const user = userQuery.rows[0];
        console.log(`[AUTH LOG] User found. Status: ${user.account_status}, Role: ${user.role}`);

        if (user.account_status === 'frozen') {
            console.log(`[AUTH LOG] Frozen account attempt: ${username}`);
            return res.render('auth/login', {
                error: 'Your account has been frozen. Please contact your administrator.'
            });
        }

        if (user.account_status === 'deleted') {
            console.log(`[AUTH LOG] Deleted account attempt: ${username}`);
            return res.render('auth/login', {
                error: 'Your account has been deactivated. Please contact your administrator.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        console.log(`[AUTH LOG] Password match result: ${isMatch}`);

        if (!isMatch) {
            return res.render('auth/login', { error: 'Invalid User ID or Password.' });
        }

        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.fullName = user.full_name;
        req.session.role = user.role;

        res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
    } catch (err) {
        console.error('[AUTH ERROR]', err);
        res.status(500).send('Internal System Error');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

module.exports = router;
