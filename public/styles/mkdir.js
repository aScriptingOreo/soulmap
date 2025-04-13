// Simple script to ensure the directory structure exists
const fs = require('fs');
const path = require('path');

// Create public/styles directory if it doesn't exist
const stylesDir = path.resolve(__dirname);
if (!fs.existsSync(stylesDir)) {
  fs.mkdirSync(stylesDir, { recursive: true });
  console.log('Created public/styles directory');
}
