import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import db from '#db';  // Use #db instead of relative import

// Import routers
import locationsRouter from './src/routes/locations.js';
import heatmapRouter from './src/routes/heatmap.js';
import eventsRouter, { broadcastToAll } from './src/routes/events.js';
import statusRouter from './src/routes/status.js';
import adminRouter from './src/routes/admin.js';
import { authenticateAdmin } from './src/middleware/auth.js';

const app = express();
const server = createServer(app);
const PORT = process.env.SERVER_PORT || 3000;

// Enhanced CORS for admin panel support - optimize for Docker network
app.use(cors({
  origin: function(origin, callback) {
    // In Docker environment, allow all origins
    // Security is handled at the network level
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Add environment variables for Discord authentication
app.use((req, res, next) => {
  // Set environment variables for Discord auth if not already set
  process.env.DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID || '1309555440102674513';
  process.env.DISCORD_ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID || '1309700533749289012';
  process.env.DISCORD_MANAGER_ROLE_ID = process.env.DISCORD_MANAGER_ROLE_ID || '1363588579506262056';
  next();
});

// Mount the routers - all with /api prefix
app.use('/api/locations', locationsRouter);
app.use('/api/heatmap', heatmapRouter);
app.use('/api/listen', eventsRouter);  // SSE endpoint
app.use('/api/status', statusRouter);   // Status includes health check
app.use('/api/admin', authenticateAdmin, adminRouter); // Protected admin routes

// Mount legacy admin routes directly for backward compatibility (can be removed later)
app.get('/api/admin/categories', async (req, res) => {
  // Forward to the admin router's implementation
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    // Get unique categories (types) from locations
    const uniqueCategories = await prisma.location.findMany({
      distinct: ['type'],
      select: {
        type: true
      },
      orderBy: {
        type: 'asc'
      }
    });
    
    // Extract the type values
    const categories = uniqueCategories.map(item => item.type);
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Health route at root level for easy access
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Setup database change listener with proper error handling
async function setupDatabaseListener() {
  try {
    await db.setupListener('location_changes', (payload) => {
      // Broadcast to all connected clients
      const data = JSON.stringify({
        type: 'change',
        data: JSON.parse(payload),
        timestamp: Date.now()
      });
      
      broadcastToAll(data);
      
      console.log(`Broadcast change to clients:`, payload);
    }).catch(error => {
      console.error('Database listener setup failed:', error.message);
      console.log('Server will continue without database change notifications');
    });
    
    console.log('Database change listener setup complete');
  } catch (error) {
    console.error('Error setting up database listener:', error);
    console.log('Server will continue without database change notifications');
  }
}

// Start server
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints available at: http://localhost:${PORT}/api/`);
  
  // Try to set up database listener but don't fail if it doesn't work
  try {
    await setupDatabaseListener();
  } catch (error) {
    console.warn('Database listener could not be initialized:', error.message);
    console.log('Server will continue without real-time updates');
  }
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  // Exit process
  process.exit(0);
});
