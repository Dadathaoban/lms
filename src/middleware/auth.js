const pool = require('../db/pool');

const redirectIfLoggedIn = (req, res, next) => {
    if (req.session.userId) {
        return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
    }
    next();
};

const protectRoute = (role) => {
    return async (req, res, next) => {
        if (!req.session.userId || req.session.role !== role) {
            return res.redirect('/login');
        }

        try {
            const userQuery = await pool.query(
                'SELECT account_status FROM users WHERE id = $1',
                [req.session.userId]
            );

            if (userQuery.rows.length === 0) {
                req.session.destroy();
                return res.redirect('/login?error=Account not found');
            }

            const status = userQuery.rows[0].account_status;

            if (status === 'frozen') {
                req.session.destroy();
                return res.redirect('/login?error=Your account has been frozen. Contact your administrator.');
            }

            if (status === 'deleted') {
                req.session.destroy();
                return res.redirect('/login?error=Your account has been deactivated.');
            }

            next();
        } catch (err) {
            console.error('[ROUTE GUARD ERROR]', err);
            return res.redirect('/login?error=System error');
        }
    };
};

module.exports = { redirectIfLoggedIn, protectRoute };
