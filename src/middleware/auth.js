const config = require('../config');

/**
 * Admin authentication middleware
 * Protects dashboard and management API routes
 * Auth via: cookie 'admin_token', header 'x-admin-key', or query '?key='
 */
function adminAuth(req, res, next) {
    const key = req.cookies?.admin_token
        || req.headers['x-admin-key']
        || req.query.key;

    if (key === config.adminKey) {
        return next();
    }

    // If requesting HTML page, redirect to login
    if (req.headers.accept?.includes('text/html')) {
        return res.redirect('/login.html');
    }

    res.status(401).json({ error: 'Unauthorized', message: 'Admin key required' });
}

module.exports = adminAuth;
