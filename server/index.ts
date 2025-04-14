import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import db from './db';

const app = express();
const server = createServer(app);
const PORT = process.env.SERVER_PORT || 3000;

// Simplified CORS - less restrictive since we're using a proxy
app.use(cors());
app.use(express.json());

// Store connected SSE clients
const clients: { id: string; res: express.Response }[] = [];

// Restore /api prefix to routes to match frontend expectations
// SSE endpoint
app.get('/api/listen', (req, res) => {
  // Set up SSE connection
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to SSE stream' })}\n\n`);
  
  // Generate client ID
  const clientId = Date.now().toString();
  
  // Store client connection
  clients.push({ id: clientId, res });
  console.log(`Client ${clientId} connected to SSE, total clients: ${clients.length}`);
  
  // Set up heartbeat to prevent connection timeout
  const heartbeatInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
  }, 30000);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    const index = clients.findIndex(client => client.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
      console.log(`Client ${clientId} disconnected, remaining clients: ${clients.length}`);
    }
  });
});

// Restore /api prefix to routes
app.get('/api/locations', async (req, res) => {
  try {
    const locations = await db.getAllLocations();
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

app.get('/api/locations/:id', async (req, res) => {
  try {
    const location = await db.getLocationById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    res.json(location);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

app.get('/api/locations/hash', async (req, res) => {
  try {
    const hash = await db.generateDatabaseHash();
    res.json({ hash });
  } catch (error) {
    console.error('Error generating database hash:', error);
    res.status(500).json({ error: 'Failed to generate hash', hash: `error-server-${Date.now()}` });
  }
});

app.get('/api/locations/hashes', async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    const locations = await prisma.location.findMany({
      select: {
        id: true,
        name: true,
        lastModified: true
      }
    });
    
    // Create a map of location name to hash
    const hashes: Record<string, string> = {};
    locations.forEach(location => {
      hashes[location.name] = location.lastModified?.getTime().toString() || Date.now().toString();
    });
    
    res.json({ hashes });
  } catch (error) {
    console.error('Error generating marker hashes:', error);
    res.status(500).json({ error: 'Failed to generate marker hashes' });
  }
});

// Add status endpoint with prefix
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    clients: clients.length,
    version: '1.0.0'
  });
});

// Add health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Setup database change listener
async function setupDatabaseListener() {
  try {
    await db.setupListener('location_changes', (payload) => {
      // Broadcast to all connected clients
      const data = JSON.stringify({
        type: 'change',
        data: JSON.parse(payload),
        timestamp: Date.now()
      });
      
      clients.forEach(client => {
        client.res.write(`data: ${data}\n\n`);
      });
      
      console.log(`Broadcast change to ${clients.length} clients:`, payload);
    });
    
    console.log('Database change listener setup complete');
  } catch (error) {
    console.error('Error setting up database listener:', error);
  }
}

// Start server
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints available at: http://localhost:${PORT}/api/`);
  await setupDatabaseListener();
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  // Close any open connections
  clients.forEach(client => {
    try {
      client.res.end();
    } catch (e) {
      // Ignore errors during shutdown
    }
  });
  
  // Exit process
  process.exit(0);
});
