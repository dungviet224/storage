const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();
const publicRouter = express.Router();

// ===== PUBLIC ROUTES (no auth - anyone with link can access) =====

// Get single media info (public)
publicRouter.get('/:id', (req, res) => {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        const baseUrl = getBaseUrl(req);
        res.json(addUrls(media, baseUrl));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stream/serve the actual file (public)
publicRouter.get('/:id/file', (req, res) => {
    serveFile(req, res);
});

// Serve HLS manifest (public)
publicRouter.get('/:id/stream/index.m3u8', (req, res) => {
    serveHLS(req, res);
});

// Serve HLS segments (public)
publicRouter.get('/:id/stream/:segment', (req, res) => {
    serveSegment(req, res);
});

// Serve thumbnail (public)
publicRouter.get('/:id/thumbnail', (req, res) => {
    serveThumbnail(req, res);
});

// ===== ADMIN ROUTES (auth required) =====

// List media with pagination & filters
router.get('/', (req, res) => {
    try {
        const { type, search, sort, order, page, limit } = req.query;
        const result = db.listMedia({ type, search, sort, order, page, limit });

        const baseUrl = getBaseUrl(req);
        result.items = result.items.map(item => addUrls(item, baseUrl));

        res.json(result);
    } catch (err) {
        console.error('[Media] List error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get single media info
router.get('/:id', (req, res) => {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        const baseUrl = getBaseUrl(req);
        res.json(addUrls(media, baseUrl));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve file (also on admin route)
router.get('/:id/file', (req, res) => {
    serveFile(req, res);
});

// HLS manifest (admin)
router.get('/:id/stream/index.m3u8', (req, res) => {
    serveHLS(req, res);
});

// HLS segments (admin)
router.get('/:id/stream/:segment', (req, res) => {
    serveSegment(req, res);
});

// Thumbnail (admin)
router.get('/:id/thumbnail', (req, res) => {
    serveThumbnail(req, res);
});

// Update media metadata
router.patch('/:id', express.json(), (req, res) => {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        db.updateMedia(req.params.id, req.body);
        const updated = db.getMedia(req.params.id);
        const baseUrl = getBaseUrl(req);
        res.json(addUrls(updated, baseUrl));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete single media
router.delete('/:id', (req, res) => {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        storage.deleteFile(media.storage_path);
        storage.deleteThumbnail(media.thumbnail);
        storage.deleteHls(media.id);
        db.deleteMedia(req.params.id);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch delete
router.post('/batch-delete', express.json(), (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array required' });
        }

        const items = db.batchGetMedia(ids);
        for (const item of items) {
            storage.deleteFile(item.storage_path);
            storage.deleteThumbnail(item.thumbnail);
            storage.deleteHls(item.id);
        }

        const result = db.batchDelete(ids);
        res.json({ success: true, deleted: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch get links
router.post('/batch-links', express.json(), (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array required' });
        }

        const baseUrl = getBaseUrl(req);
        const items = db.batchGetMedia(ids);
        const links = items.map(item => ({
            id: item.id,
            name: item.original_name,
            type: item.type,
            directUrl: `${baseUrl}/api/media/${item.id}/file`,
            playerUrl: item.type === 'video' ? `${baseUrl}/watch.html?v=${item.id}` : `${baseUrl}/api/media/${item.id}/file`,
            thumbnailUrl: `${baseUrl}/api/media/${item.id}/thumbnail`
        }));

        res.json({ links });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== SHARED HANDLER FUNCTIONS =====

function serveFile(req, res) {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        const filePath = storage.getFilePath(media.storage_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize) {
                res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
                return;
            }

            const chunkSize = end - start + 1;
            const stream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': media.mime,
                'Cache-Control': 'public, max-age=86400'
            });

            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': media.mime,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=86400',
                'Content-Disposition': `inline; filename="${encodeURIComponent(media.original_name)}"`
            });

            fs.createReadStream(filePath).pipe(res);
        }
    } catch (err) {
        console.error('[Media] File serve error:', err);
        res.status(500).json({ error: err.message });
    }
}

function serveHLS(req, res) {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        if (!media.hls_path) {
            return res.status(404).json({ error: 'HLS not available' });
        }

        const hlsFile = path.join(config.storagePath, media.hls_path);
        if (!fs.existsSync(hlsFile)) {
            return res.status(404).json({ error: 'HLS manifest not found' });
        }

        let manifest = fs.readFileSync(hlsFile, 'utf-8');
        manifest = manifest.replace(/seg_(\d+)\.ts/g, `/api/media/${media.id}/stream/seg_$1.ts`);

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(manifest);
    } catch (err) {
        console.error('[Media] HLS manifest error:', err);
        res.status(500).json({ error: err.message });
    }
}

function serveSegment(req, res) {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        const segName = req.params.segment;
        if (!/^seg_\d+\.ts$/.test(segName)) {
            return res.status(400).json({ error: 'Invalid segment name' });
        }

        const hlsDir = storage.getHlsDir(media.id);
        const segPath = path.join(hlsDir, segName);

        if (!fs.existsSync(segPath)) {
            return res.status(404).json({ error: 'Segment not found' });
        }

        const stat = fs.statSync(segPath);
        res.writeHead(200, {
            'Content-Type': 'video/mp2t',
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(segPath).pipe(res);
    } catch (err) {
        console.error('[Media] HLS segment error:', err);
        res.status(500).json({ error: err.message });
    }
}

function serveThumbnail(req, res) {
    try {
        const media = db.getMedia(req.params.id);
        if (!media) return res.status(404).json({ error: 'Not found' });

        if (media.thumbnail) {
            const thumbPath = path.join(config.storagePath, media.thumbnail);
            if (fs.existsSync(thumbPath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800');
                return res.sendFile(thumbPath);
            }
        }

        if (media.type === 'image') {
            const filePath = storage.getFilePath(media.storage_path);
            if (fs.existsSync(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800');
                return res.sendFile(filePath);
            }
        }

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#1a1a2e"/>
      <text x="160" y="90" text-anchor="middle" fill="#666" font-size="14" font-family="sans-serif">${media.type === 'video' ? '🎬 Video' : '🖼️ Image'}</text>
    </svg>`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ===== HELPERS =====

function getBaseUrl(req) {
    if (config.baseUrl) return config.baseUrl;
    return `${req.protocol}://${req.get('host')}`;
}

function addUrls(item, baseUrl) {
    return {
        ...item,
        urls: {
            file: `${baseUrl}/api/media/${item.id}/file`,
            thumbnail: `${baseUrl}/api/media/${item.id}/thumbnail`,
            stream: item.hls_path ? `${baseUrl}/api/media/${item.id}/stream/index.m3u8` : null,
            player: item.type === 'video' ? `${baseUrl}/watch.html?v=${item.id}` : null,
            api: `${baseUrl}/api/media/${item.id}`
        }
    };
}

module.exports = router;
module.exports.publicRouter = publicRouter;
