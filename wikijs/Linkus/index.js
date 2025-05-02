const chokidar = require('chokidar');
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Configuration from environment variables
const BASE_PATH = process.env.BASE_PATH || 'https://wiki.avakot.org/';
const TARGET_DIR = process.env.TARGET_DIR || '/app/repo';
const PORT = process.env.PORT || 3022;
const HOST_NAME = process.env.HOST_NAME || 'linkus.7thseraph.org';

// Store for file mappings
let linkMap = {};
let initialScanComplete = false;

// Initialize Express server
const app = express();

// Add CORS headers to allow requests from any origin
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Log all incoming requests to help with debugging
app.use((req, res, next) => {
    console.log(`Received request: ${req.method} ${req.url} from ${req.ip} with host header: ${req.headers.host}`);
    next();
});

// Function to update the link map
function updateLinkMap(filePath, isRemoval = false, isInitialScan = false) {
    // Get relative path from target directory
    const relativePath = path.relative(TARGET_DIR, filePath);

    // Skip if this isn't an HTML or MD file
    if (!filePath.match(/\.(md|html)$/i)) return;

    // Extract filename without extension for display purposes
    const fileName = path.basename(filePath, path.extname(filePath));

    if (isRemoval) {
        // Remove from map if file is deleted
        delete linkMap[fileName];

        if (!isInitialScan) {
            console.log(`Removed mapping for: ${fileName}`);
        }
    } else {
        // Create wiki URL path - convert backslashes to forward slashes for URLs
        const wikiPath = relativePath.replace(/\\/g, '/').replace(/\.(md|html)$/i, '');

        // Add or update the mapping
        linkMap[fileName] = `${BASE_PATH}${wikiPath}`;

        if (!isInitialScan) {
            console.log(`Added/updated mapping: "${fileName}" -> "${linkMap[fileName]}"`);
        }
    }

    // Only log the full map if it's not the initial scan or if it's the last file of the initial scan
    if (!isInitialScan && initialScanComplete) {
        console.log('Link map updated.');
    }
}

// Set up file watcher with special handling for initial scan
console.log('Starting initial scan of files...');
let pendingInitialFiles = 0;

const watcher = chokidar.watch(`${TARGET_DIR}/**/*.{md,html}`, {
    persistent: true,
    ignoreInitial: false
})
    .on('add', (filePath) => {
        if (!initialScanComplete) {
            pendingInitialFiles++;
            updateLinkMap(filePath, false, true);
        } else {
            console.log(`File added: ${filePath}`);
            updateLinkMap(filePath);
        }
    })
    .on('change', (filePath) => {
        if (initialScanComplete) {
            console.log(`File changed: ${filePath}`);
            updateLinkMap(filePath);
        }
    })
    .on('unlink', (filePath) => {
        if (initialScanComplete) {
            console.log(`File removed: ${filePath}`);
            updateLinkMap(filePath, true);
        }
    })
    .on('ready', () => {
        initialScanComplete = true;
        console.log(`Initial scan complete. Found ${Object.keys(linkMap).length} files.`);
        console.log('Link map created and ready to serve.');
    });

// API endpoint to serve the link map
app.get('/', (req, res) => {
    // Ensure consistent JSON format with quoted keys and values
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(linkMap, null, 2));
});

// Add a health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Add a catch-all route for diagnostic purposes
app.get('*', (req, res) => {
    res.status(200).json({
        message: 'Linkus API is running',
        time: new Date().toISOString(),
        requestPath: req.path,
        hostHeader: req.headers.host,
        availableEndpoints: ['/', '/health'],
        linkMapSize: Object.keys(linkMap).length
    });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Linkus server running on port ${PORT}`);
    console.log(`Service should be accessible at: https://${HOST_NAME}`);
    console.log(`Monitoring directory: ${TARGET_DIR}`);
    console.log(`Base wiki path: ${BASE_PATH}`);
});
