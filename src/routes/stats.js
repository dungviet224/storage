const express = require('express');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

router.get('/', (req, res) => {
    try {
        const stats = db.getStats();
        const diskUsage = storage.getStorageSize();

        // Ensure byType always has both image and video entries
        if (!stats.byType.image) stats.byType.image = { count: 0, size: 0 };
        if (!stats.byType.video) stats.byType.video = { count: 0, size: 0 };

        res.json({
            ...stats,
            diskUsage
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
