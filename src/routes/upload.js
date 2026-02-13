const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const config = require('../config');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

// Multer config - use temp directory
const upload = multer({
    dest: path.join(os.tmpdir(), 'media-uploads'),
    limits: {
        fileSize: config.maxFileSize,
        files: config.maxFiles
    },
    fileFilter: (req, file, cb) => {
        if (config.allAllowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} is not allowed`));
        }
    }
});

// Upload single or multiple files
router.post('/', upload.array('files', config.maxFiles), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const results = [];

        for (const file of req.files) {
            // Save file to storage
            const mediaInfo = storage.saveFile(file);

            // Insert into database with 'processing' status
            db.insertMedia({
                ...mediaInfo,
                width: null,
                height: null,
                duration: null,
                thumbnail: null,
                tags: req.body.tags || '',
                description: req.body.description || ''
            });

            // Process in background (metadata + thumbnail + HLS)
            processMedia(mediaInfo).catch(err => {
                console.error(`[Upload] Process error for ${mediaInfo.id}:`, err);
            });

            results.push(mediaInfo);
        }

        res.json({
            success: true,
            uploaded: results.length,
            files: results.map(r => ({
                id: r.id,
                name: r.original_name,
                type: r.type,
                size: r.size
            }))
        });
    } catch (err) {
        console.error('[Upload] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Background processing for uploaded media
async function processMedia(mediaInfo) {
    try {
        const updates = {};

        if (mediaInfo.type === 'video') {
            // Get video metadata
            const metadata = await storage.getVideoMetadata(mediaInfo.storage_path);
            updates.width = metadata.width;
            updates.height = metadata.height;
            updates.duration = metadata.duration;

            // Generate thumbnail
            const thumbPath = await storage.generateVideoThumbnail(mediaInfo.storage_path, mediaInfo.id);
            if (thumbPath) {
                updates.thumbnail = thumbPath;
            }

            // Convert to HLS for streaming
            const hlsPath = await storage.convertToHLS(mediaInfo.storage_path, mediaInfo.id);
            if (hlsPath) {
                updates.hls_path = hlsPath;
            }
        }

        updates.status = 'ready';
        db.updateMedia(mediaInfo.id, updates);
        console.log(`[Upload] Processed: ${mediaInfo.id} (${mediaInfo.original_name})`);
    } catch (err) {
        db.updateMedia(mediaInfo.id, { status: 'error' });
        throw err;
    }
}

module.exports = router;
