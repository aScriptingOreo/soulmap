const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'requests.db');
let db;

function initializeDatabase() {
  try {
    db = new Database(DB_PATH);
    
    // Create requests table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS location_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        coordinates TEXT NOT NULL,
        description TEXT NOT NULL,
        screenshot_url TEXT,
        status TEXT DEFAULT 'pending',
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database:', error);
    return false;
  }
}

function saveRequest(messageId, userId, coordinates, description, screenshotUrl = null) {
  try {
    const stmt = db.prepare(
      'INSERT INTO location_requests (message_id, user_id, coordinates, description, screenshot_url) VALUES (?, ?, ?, ?, ?)'
    );
    
    const result = stmt.run(messageId, userId, coordinates, description, screenshotUrl);
    console.log(`Saved request to database with ID: ${result.lastInsertRowid}`);
    return result.lastInsertRowid;
  } catch (error) {
    console.error('Error saving request to database:', error);
    return null;
  }
}

function updateRequestStatus(messageId, status, reason = null) {
  try {
    const stmt = db.prepare(
      'UPDATE location_requests SET status = ?, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE message_id = ?'
    );
    
    const result = stmt.run(status, reason, messageId);
    console.log(`Updated request status: ${messageId} -> ${status}`);
    return result.changes > 0;
  } catch (error) {
    console.error('Error updating request status:', error);
    return false;
  }
}

function getRequestsByStatus(status) {
  try {
    const stmt = db.prepare('SELECT * FROM location_requests WHERE status = ? ORDER BY created_at DESC');
    return stmt.all(status);
  } catch (error) {
    console.error(`Error getting requests with status ${status}:`, error);
    return [];
  }
}

function getAllRequests() {
  try {
    const stmt = db.prepare('SELECT * FROM location_requests ORDER BY created_at DESC');
    return stmt.all();
  } catch (error) {
    console.error('Error getting all requests:', error);
    return [];
  }
}

function getRequestByMessageId(messageId) {
  try {
    const stmt = db.prepare('SELECT * FROM location_requests WHERE message_id = ?');
    return stmt.get(messageId);
  } catch (error) {
    console.error(`Error getting request with message ID ${messageId}:`, error);
    return null;
  }
}

module.exports = {
  initializeDatabase,
  saveRequest,
  updateRequestStatus,
  getRequestsByStatus,
  getAllRequests,
  getRequestByMessageId
};
