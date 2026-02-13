const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db;

async function init() {
    // Ensure data directory exists
    fs.mkdirSync(config.dataPath, { recursive: true });

    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(config.dbPath)) {
        const buffer = fs.readFileSync(config.dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      type TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration REAL,
      thumbnail TEXT,
      storage_path TEXT NOT NULL,
      hls_path TEXT,
      tags TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'processing',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

    // Migration: add hls_path if not exists
    try { db.run('ALTER TABLE media ADD COLUMN hls_path TEXT'); } catch (e) { /* already exists */ }

    db.run('CREATE INDEX IF NOT EXISTS idx_media_type ON media(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_media_status ON media(status)');

    // Auto-save every 30 seconds
    setInterval(() => saveToFile(), 30000);

    return db;
}

function saveToFile() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(config.dbPath, buffer);
    } catch (err) {
        console.error('[DB] Save error:', err.message);
    }
}

function getDb() {
    if (!db) throw new Error('Database not initialized. Call init() first.');
    return db;
}

// Helper to run a query and get results as array of objects
function queryAll(sql, params = []) {
    const stmt = getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

function runSql(sql, params = []) {
    getDb().run(sql, params);
    saveToFile();
}

// ---- CRUD Operations ----

function insertMedia(media) {
    runSql(`
    INSERT INTO media (id, filename, original_name, type, mime, size, width, height, duration, thumbnail, storage_path, tags, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [media.id, media.filename, media.original_name, media.type, media.mime, media.size,
    media.width, media.height, media.duration, media.thumbnail, media.storage_path,
    media.tags || '', media.description || '', media.status || 'ready']);
}

function getMedia(id) {
    return queryOne('SELECT * FROM media WHERE id = ?', [id]);
}

function listMedia({ type, search, sort, order, page, limit }) {
    let where = [];
    let params = [];

    if (type && type !== 'all') {
        where.push('type = ?');
        params.push(type);
    }

    if (search) {
        where.push('(original_name LIKE ? OR tags LIKE ? OR description LIKE ?)');
        const s = `%${search}%`;
        params.push(s, s, s);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Sort
    const allowedSorts = ['created_at', 'original_name', 'size', 'duration'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    // Pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(config.maxPageSize, Math.max(1, parseInt(limit) || config.defaultPageSize));
    const offset = (pageNum - 1) * pageSize;

    const countResult = queryOne(`SELECT COUNT(*) as total FROM media ${whereClause}`, params);
    const total = countResult ? countResult.total : 0;

    const items = queryAll(
        `SELECT * FROM media ${whereClause} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    );

    return {
        items,
        pagination: {
            page: pageNum,
            limit: pageSize,
            total,
            totalPages: Math.ceil(total / pageSize)
        }
    };
}

function updateMedia(id, fields) {
    const allowed = ['tags', 'description', 'status', 'thumbnail', 'width', 'height', 'duration', 'hls_path'];
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(fields)) {
        if (allowed.includes(key)) {
            updates.push(`${key} = ?`);
            params.push(value);
        }
    }

    if (updates.length === 0) return null;
    updates.push("updated_at = datetime('now')");
    params.push(id);

    runSql(`UPDATE media SET ${updates.join(', ')} WHERE id = ?`, params);
}

function deleteMedia(id) {
    runSql('DELETE FROM media WHERE id = ?', [id]);
}

function batchDelete(ids) {
    if (!ids.length) return { changes: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const before = queryOne('SELECT COUNT(*) as c FROM media')?.c || 0;
    runSql(`DELETE FROM media WHERE id IN (${placeholders})`, ids);
    const after = queryOne('SELECT COUNT(*) as c FROM media')?.c || 0;
    return { changes: before - after };
}

function getStats() {
    const total = queryOne('SELECT COUNT(*) as count FROM media');
    const byType = queryAll('SELECT type, COUNT(*) as count, SUM(size) as total_size FROM media GROUP BY type');
    const totalSize = queryOne('SELECT SUM(size) as total_size FROM media');
    const recent = queryAll('SELECT * FROM media ORDER BY created_at DESC LIMIT 5');

    return {
        totalFiles: total ? total.count : 0,
        totalSize: totalSize ? (totalSize.total_size || 0) : 0,
        byType: byType.reduce((acc, row) => {
            acc[row.type] = { count: row.count, size: row.total_size || 0 };
            return acc;
        }, {}),
        recent
    };
}

function batchGetMedia(ids) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return queryAll(`SELECT * FROM media WHERE id IN (${placeholders})`, ids);
}

module.exports = {
    init,
    getDb,
    saveToFile,
    insertMedia,
    getMedia,
    listMedia,
    updateMedia,
    deleteMedia,
    batchDelete,
    batchGetMedia,
    getStats
};
