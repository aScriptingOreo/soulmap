import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

// Import routers
import locationsRouter from './routes/locations.js';
import heatmapRouter from './routes/heatmap.js';
import eventsRouter from './routes/events.js';
import statusRouter from './routes/status.js';
import adminRouter from './routes/admin.js'; 
import { authenticateAdmin } from './middleware/auth.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Mount the routers - all with /api prefix
app.use('/api/locations', locationsRouter);
app.use('/api/heatmap', heatmapRouter);
app.use('/api/listen', eventsRouter);
app.use('/api/status', statusRouter);
app.use('/api/admin', authenticateAdmin, adminRouter);

// Health route at root level
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Also add API health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export { app, server };
