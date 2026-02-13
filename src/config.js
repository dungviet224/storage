const path = require('path');

const config = {
  port: process.env.PORT || 3900,
  host: process.env.HOST || '0.0.0.0',

  // Storage
  storagePath: path.join(__dirname, '..', 'media'),
  dataPath: path.join(__dirname, '..', 'data'),
  dbPath: path.join(__dirname, '..', 'data', 'media.db'),

  // Upload limits
  maxFileSize: 500 * 1024 * 1024, // 500MB
  maxFiles: 20, // max files per upload

  // Allowed MIME types
  allowedTypes: {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'],
    video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']
  },

  // Thumbnail
  thumbnailWidth: 320,
  thumbnailHeight: 180,

  // API keys (set via env or use default for dev)
  apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',') : [],

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // requests per window
    uploadMax: 50 // upload requests per window
  },

  // Pagination
  defaultPageSize: 30,
  maxPageSize: 100,

  // Base URL for generating links
  baseUrl: process.env.BASE_URL || null, // auto-detect if null

  // Admin auth
  adminKey: process.env.ADMIN_KEY || '24062010'
};

// Flatten allowed types for quick lookup
config.allAllowedTypes = [...config.allowedTypes.image, ...config.allowedTypes.video];

module.exports = config;
