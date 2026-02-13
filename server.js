const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./src/config');
const db = require('./src/database');
const adminAuth = require('./src/middleware/auth');

async function startServer() {
    await db.init();

    const app = express();

    // Security & performance middleware
    app.use(cors());
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));
    app.use(compression({
        filter: (req, res) => {
            const type = res.getHeader('Content-Type') || '';
            if (type.startsWith('video/') || type.startsWith('image/')) return false;
            return compression.filter(req, res);
        }
    }));
    app.use(cookieParser());
    app.use(express.json());

    // Rate limiting
    app.use('/api/', rateLimit({
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests' }
    }));

    // ===== PUBLIC AUTH ROUTES =====
    app.post('/api/auth/login', (req, res) => {
        if (req.body.key === config.adminKey) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid key' });
        }
    });

    app.get('/api/auth/verify', (req, res) => {
        const key = req.cookies?.admin_token || req.headers['x-admin-key'] || req.query.key;
        res.json({ valid: key === config.adminKey });
    });

    app.get('/api/auth/logout', (req, res) => {
        res.clearCookie('admin_token');
        res.redirect('/login.html');
    });

    // ===== PUBLIC MEDIA API (view/stream only) =====
    const mediaRoutes = require('./src/routes/media');
    app.use('/api/media', mediaRoutes.publicRouter);

    // ===== PUBLIC STATIC =====
    app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
    app.get('/watch.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'watch.html')));

    // ===== PROTECTED: Dashboard =====
    app.get('/', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
    app.get('/index.html', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

    // Static assets (CSS, JS, images - no auth needed)
    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: '1h',
        etag: true,
        index: false
    }));

    // ===== PROTECTED API (admin only) =====
    app.use('/api/upload', adminAuth, require('./src/routes/upload'));
    app.use('/api/media', adminAuth, mediaRoutes);
    app.use('/api/stats', adminAuth, require('./src/routes/stats'));

    // Health check (public)
    app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

    // Error handler
    app.use((err, req, res, next) => {
        console.error('[Server] Error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `File too large. Max: ${config.maxFileSize / 1024 / 1024}MB` });
        }
        if (err.message?.includes('not allowed')) {
            return res.status(415).json({ error: err.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    });

    // Graceful shutdown
    process.on('SIGINT', () => { console.log('\n[Server] Saving database...'); db.saveToFile(); process.exit(0); });
    process.on('SIGTERM', () => { db.saveToFile(); process.exit(0); });

    app.listen(config.port, config.host, () => {
        console.log('');
        console.log('======================================');
        console.log('  Media Storage Server v1.0');
        console.log('======================================');
        console.log(`  Dashboard:  http://localhost:${config.port}`);
        console.log(`  API Base:   http://localhost:${config.port}/api`);
        console.log(`  Admin Key:  ${config.adminKey}`);
        console.log('======================================');
        console.log('');
    });
}

startServer().catch(err => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
});
