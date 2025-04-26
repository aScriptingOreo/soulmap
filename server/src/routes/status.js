import express from 'express';
import { getClients } from './events.js';

const router = express.Router();
console.log('Status router file loaded.');

// Server version - should be updated with each release
const SERVER_VERSION = '1.0.0';

// Status endpoint
router.get('/', (req, res) => {
  const clients = getClients();
  res.json({
    status: 'ok',
    clients: clients.length,
    version: SERVER_VERSION
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;
