// Simple test to check database theme functionality
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

try {
  // Check if users table exists and has theme column
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  console.log('Users table columns:', tableInfo.map(col => col.name));
  
  const hasThemeColumn = tableInfo.some(col => col.name === 'theme');
  console.log('Has theme column:', hasThemeColumn);
  
  if (hasThemeColumn) {
    // Get all users and their themes
    const users = db.prepare('SELECT id, username, theme FROM users').all();
    console.log('Users and their themes:', users);
  }
  
  // Check config.json themes
  const config = require('./config.json');
  console.log('Available themes in config:', Object.keys(config.themes));
  
} catch (error) {
  console.error('Database test error:', error);
} finally {
  db.close();
}