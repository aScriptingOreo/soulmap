import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import db from './db';
import fetch from 'node-fetch';
// Remove the problematic import
// import adminRoutes from './src/routes/admin.js';

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

// Store connected SSE clients
const clients: { id: string; res: express.Response }[] = [];

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

// Define interfaces for Discord data structures
interface DiscordUser {
  id: string;
  username: string;
  avatar: string;
  discriminator: string;
}

interface DiscordGuild {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
}

interface DiscordGuildMember {
  roles: string[];
  user?: DiscordUser;
}

// Admin-specific endpoints - protected with basic authentication for now
// In a real application, you'd use a more robust auth system
const adminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // This is just a placeholder - you should implement proper authentication
  const adminToken = process.env.ADMIN_API_TOKEN || 'dev-token';
  const isAdmin = req.headers['x-admin-token'] === adminToken;
  
  if (isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Admin endpoints for requests management
app.get('/api/admin/requests', adminAuth, async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    // Get discord location requests - using any to bypass type checking for now
    // This assumes the schema has a model called "discord_location_requests" 
    const requests = await (prisma as any).discordLocationRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100  // Limit results
    });
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Admin endpoint to approve/reject requests
app.post('/api/admin/requests/:id/status', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    // Using any to bypass type checking for the prisma client model
    const updated = await (prisma as any).discordLocationRequest.update({
      where: { id },
      data: { 
        status,
        reason,
        implementedAt: status === 'approved' ? new Date() : undefined,
        implementedBy: status === 'approved' ? 'admin-panel' : undefined
      }
    });
    
    // Notify clients about the change
    const data = JSON.stringify({
      type: 'request_update',
      data: {
        id: updated.id,
        status: updated.status
      },
      timestamp: Date.now()
    });
    
    clients.forEach(client => {
      client.res.write(`data: ${data}\n\n`);
    });
    
    res.json(updated);
  } catch (error) {
    console.error('Error updating request status:', error);
    res.status(500).json({ error: 'Failed to update request status' });
  }
});

// Admin endpoint for stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    // Get count of locations
    const locationsCount = await prisma.location.count();
    
    // Get counts of requests by status
    const pendingRequests = await (prisma as any).discordLocationRequest.count({
      where: { status: 'pending' }
    });
    
    // Get counts of approved requests in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentApprovedRequests = await (prisma as any).discordLocationRequest.count({
      where: { 
        status: 'approved',
        implementedAt: {
          gte: thirtyDaysAgo
        }
      }
    });
    
    res.json({
      totalLocations: locationsCount,
      pendingRequests,
      recentUpdates: recentApprovedRequests
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Discord OAuth validation endpoint
app.post('/api/admin/auth/validate', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ valid: false, message: 'Token is required' });
  }
  
  try {
    // Discord API URLs
    const USER_API = 'https://discord.com/api/v10/users/@me';
    const GUILDS_API = 'https://discord.com/api/v10/users/@me/guilds';
    const GUILD_MEMBER_API = (guildId: string, userId: string) => 
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
    
    // Required IDs from environment variables
    const SERVER_ID = process.env.DISCORD_SERVER_ID || '1309555440102674513';
    const ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID || '1309700533749289012';
    const MANAGER_ROLE_ID = process.env.DISCORD_MANAGER_ROLE_ID || '1363588579506262056';
    
    // Get user info
    const userResponse = await fetch(USER_API, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!userResponse.ok) {
      return res.status(401).json({ 
        valid: false, 
        message: 'Invalid or expired Discord token' 
      });
    }
    
    const userData = await userResponse.json() as DiscordUser;
    
    // Get user's guilds (servers)
    const guildsResponse = await fetch(GUILDS_API, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!guildsResponse.ok) {
      return res.status(401).json({ 
        valid: false, 
        message: 'Failed to fetch user guilds' 
      });
    }
    
    const guildsData = await guildsResponse.json() as DiscordGuild[];
    
    // Check if user is in the required server
    const isInServer = guildsData.some((guild) => guild.id === SERVER_ID);
    
    if (!isInServer) {
      return res.status(403).json({
        valid: false,
        message: 'You are not a member of the required Discord server'
      });
    }
    
    // Get user's roles in the server using bot token
    // Note: This requires bot token with appropriate permissions
    const BOT_TOKEN = process.env.discord_bot_token;
    
    if (!BOT_TOKEN) {
      return res.status(500).json({
        valid: false,
        message: 'Server configuration error'
      });
    }
    
    const memberResponse = await fetch(GUILD_MEMBER_API(SERVER_ID, userData.id), {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    
    if (!memberResponse.ok) {
      return res.status(500).json({
        valid: false,
        message: 'Failed to verify server roles'
      });
    }
    
    const memberData = await memberResponse.json() as DiscordGuildMember;
    
    // Check if user has required roles
    const hasRequiredRole = memberData.roles.includes(ADMIN_ROLE_ID) || 
                            memberData.roles.includes(MANAGER_ROLE_ID);
    
    if (!hasRequiredRole) {
      return res.status(403).json({
        valid: false,
        message: 'You do not have the required permissions'
      });
    }
    
    // If all checks pass, return validated user info with roles
    return res.json({
      valid: true,
      user: {
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar,
        discriminator: userData.discriminator,
        roles: memberData.roles
      }
    });
  } catch (error) {
    console.error('Error validating Discord token:', error);
    res.status(500).json({ 
      valid: false, 
      message: 'Failed to validate authentication' 
    });
  }
});

// Add categories endpoint
app.get('/api/admin/categories', async (req, res) => {
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

// Get location by ID
app.get('/api/admin/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    const location = await prisma.location.findUnique({
      where: { id }
    });
    
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    res.json(location);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

// Update location by ID
app.put('/api/admin/locations/:id', async (req, res) => {
  const { id } = req.params;
  const { coordinates, ...restData } = req.body;
  
  const data = { ...restData };
  
  // Handle coordinates if provided
  if (coordinates && Array.isArray(coordinates)) {
    data.coordinates = coordinates;
  }
  
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    const updatedLocation = await prisma.location.update({
      where: { id },
      data
    });
    
    res.json(updatedLocation);
  } catch (error) {
    console.error('Error updating location:', error.message || error);
    
    // Check for Prisma not found error
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Location not found for update' });
    }
    
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Delete location by ID
app.delete('/api/admin/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    await prisma.location.delete({
      where: { id }
    });
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
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
