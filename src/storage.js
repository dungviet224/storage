const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

let ffmpeg = null;
let ffmpegAvailable = false;

// Try to load fluent-ffmpeg (silent check)
try {
    const ff = require('fluent-ffmpeg');
    const { execSync } = require('child_process');
    try {
        execSync('ffprobe -version', { stdio: 'ignore' });
        execSync('ffmpeg -version', { stdio: 'ignore' });
        ffmpeg = ff;
        ffmpegAvailable = true;
        console.log('[Storage] FFmpeg detected - HLS streaming & thumbnails enabled');
    } catch {
        console.log('[Storage] FFmpeg/FFprobe not found - HLS disabled, using direct streaming');
    }
} catch (e) {
    console.log('[Storage] fluent-ffmpeg not installed - HLS disabled');
}

/**
 * Get the storage directory for a given date (YYYY/MM structure)
 */
function getStorageDir(date = new Date()) {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const dir = path.join(config.storagePath, year, month);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Get thumbnail directory
 */
function getThumbnailDir() {
    const dir = path.join(config.storagePath, '_thumbnails');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Save uploaded file to storage
 */
function saveFile(file) {
    const id = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${id}${ext}`;
    const storageDir = getStorageDir();
    const relativePath = path.relative(config.storagePath, storageDir);
    const destPath = path.join(storageDir, filename);

    // Move file from multer temp to storage (copy+unlink for cross-device support on Windows)
    fs.copyFileSync(file.path, destPath);
    try { fs.unlinkSync(file.path); } catch (e) { /* ignore cleanup error */ }

    const type = config.allowedTypes.video.includes(file.mimetype) ? 'video' : 'image';

    return {
        id,
        filename,
        original_name: file.originalname,
        type,
        mime: file.mimetype,
        size: file.size,
        storage_path: path.join(relativePath, filename),
        status: 'processing'
    };
}

/**
 * Get absolute path to a media file
 */
function getFilePath(storagePath) {
    return path.join(config.storagePath, storagePath);
}

/**
 * Generate thumbnail for video using FFmpeg
 */
function generateVideoThumbnail(storagePath, id) {
    return new Promise((resolve) => {
        if (!ffmpegAvailable) {
            resolve(null);
            return;
        }

        const inputPath = getFilePath(storagePath);
        const thumbDir = getThumbnailDir();
        const thumbFilename = `${id}.jpg`;
        const thumbPath = path.join(thumbDir, thumbFilename);

        try {
            ffmpeg(inputPath)
                .on('end', () => {
                    resolve(`_thumbnails/${thumbFilename}`);
                })
                .on('error', (err) => {
                    console.error(`[Storage] Thumbnail error for ${id}:`, err.message);
                    resolve(null);
                })
                .screenshots({
                    count: 1,
                    folder: thumbDir,
                    filename: thumbFilename,
                    size: `${config.thumbnailWidth}x?`
                });
        } catch (err) {
            console.error(`[Storage] Thumbnail error for ${id}:`, err.message);
            resolve(null);
        }
    });
}

/**
 * Generate thumbnail for image (simple copy/resize - using canvas if available, else skip)
 */
function generateImageThumbnail(storagePath, id) {
    return new Promise((resolve) => {
        // For images, we use the original as thumbnail (browser can resize)
        // In production, you'd use sharp here
        resolve(null);
    });
}

/**
 * Extract video metadata using FFprobe
 */
function getVideoMetadata(storagePath) {
    return new Promise((resolve) => {
        if (!ffmpegAvailable) {
            resolve({ width: null, height: null, duration: null });
            return;
        }

        const inputPath = getFilePath(storagePath);

        try {
            ffmpeg.ffprobe(inputPath, (err, metadata) => {
                if (err) {
                    console.error('[Storage] ffprobe error:', err.message);
                    resolve({ width: null, height: null, duration: null });
                    return;
                }

                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                resolve({
                    width: videoStream ? videoStream.width : null,
                    height: videoStream ? videoStream.height : null,
                    duration: metadata.format ? metadata.format.duration : null
                });
            });
        } catch (err) {
            resolve({ width: null, height: null, duration: null });
        }
    });
}

/**
 * Delete a file from storage
 */
function deleteFile(storagePath) {
    const absPath = getFilePath(storagePath);
    try {
        if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
        }
    } catch (err) {
        console.error(`[Storage] Delete error: ${err.message}`);
    }
}

/**
 * Delete a thumbnail
 */
function deleteThumbnail(thumbnailPath) {
    if (!thumbnailPath) return;
    const absPath = path.join(config.storagePath, thumbnailPath);
    try {
        if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
        }
    } catch (err) {
        console.error(`[Storage] Delete thumbnail error: ${err.message}`);
    }
}

/**
 * Get storage stats
 */
function getStorageSize() {
    try {
        return getDirSize(config.storagePath);
    } catch {
        return 0;
    }
}

function getDirSize(dirPath) {
    let size = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                size += fs.statSync(fullPath).size;
            } else if (entry.isDirectory()) {
                size += getDirSize(fullPath);
            }
        }
    } catch { }
    return size;
}

/**
 * Get HLS directory for a media item
 */
function getHlsDir(mediaId) {
    return path.join(config.storagePath, '_hls', mediaId);
}

/**
 * Convert video to HLS (m3u8 + ts segments) using FFmpeg
 * Returns relative path to m3u8 or null if failed
 */
function convertToHLS(storagePath, mediaId) {
    return new Promise((resolve) => {
        if (!ffmpegAvailable) {
            resolve(null);
            return;
        }

        const inputPath = getFilePath(storagePath);
        const hlsDir = getHlsDir(mediaId);
        fs.mkdirSync(hlsDir, { recursive: true });

        const outputPath = path.join(hlsDir, 'index.m3u8');

        try {
            console.log(`[HLS] Converting ${mediaId}...`);

            ffmpeg(inputPath)
                .outputOptions([
                    '-codec:v libx264',
                    '-codec:a aac',
                    '-preset fast',
                    '-crf 23',
                    '-movflags +faststart',
                    '-hls_time 6',
                    '-hls_list_size 0',
                    '-hls_segment_filename', path.join(hlsDir, 'seg_%03d.ts'),
                    '-hls_playlist_type vod',
                    '-f hls'
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log(`[HLS] Done: ${mediaId}`);
                    resolve(`_hls/${mediaId}/index.m3u8`);
                })
                .on('error', (err) => {
                    console.error(`[HLS] Error for ${mediaId}:`, err.message);
                    // Clean up failed conversion
                    try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch (e) { }
                    resolve(null);
                })
                .run();
        } catch (err) {
            console.error(`[HLS] Error for ${mediaId}:`, err.message);
            resolve(null);
        }
    });
}

/**
 * Delete HLS folder for a media item
 */
function deleteHls(mediaId) {
    if (!mediaId) return;
    const hlsDir = getHlsDir(mediaId);
    try {
        if (fs.existsSync(hlsDir)) {
            fs.rmSync(hlsDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.error(`[Storage] Delete HLS error: ${err.message}`);
    }
}

module.exports = {
    saveFile,
    getFilePath,
    generateVideoThumbnail,
    generateImageThumbnail,
    getVideoMetadata,
    convertToHLS,
    getHlsDir,
    deleteFile,
    deleteThumbnail,
    deleteHls,
    getStorageSize,
    getThumbnailDir,
    isFFmpegAvailable: () => ffmpegAvailable
};
