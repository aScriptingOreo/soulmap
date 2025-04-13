// Simple script to ensure the directory structure exists
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create res/styles directory if it doesn't exist
const stylesDir = __dirname;
if (!fs.existsSync(stylesDir)) {
  fs.mkdirSync(stylesDir, { recursive: true });
  console.log('Created res/styles directory');
}
