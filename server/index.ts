import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { setTimeout } from 'timers/promises';
import path from 'path';

const MAX_RETRIES = 10;
const RETRY_DELAY = 3000; // 3 seconds

// Create Express app
const app = express();
// Use SERVER_PORT from environment variable, default to 3000 if not set
const PORT = process.env.SERVER_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Add static file serving for styles
app.use('/styles', express.static(path.join(__dirname, '../dist/styles')));
app.use(express.static(path.join(__dirname, '../dist')));

// Health check endpoint (crucial for startup sequence)
app.get('/health', (req, res) => {
  const dbStatus = globalThis.__dbConnected === true;
  if (dbStatus) {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
  } else {
    res.status(503).json({ status: 'error', message: 'Database not connected' });
  }
});

// Database hash endpoint
app.get('/locations/hash', async (req, res) => {
  try {
    // Generate a hash based on the count and most recent modification date
    const stats = await prisma.location.aggregate({
      _count: { id: true },
      _max: { lastModified: true }
    });
    
    const hash = `${stats._count.id}-${stats._max.lastModified?.getTime() || Date.now()}`;
    res.json({ hash });
  } catch (error) {
    console.error('Error generating location hash:', error);
    res.status(500).json({ error: 'Failed to generate location hash' });
  }
});

// Declare Prisma outside the initialization function to make it accessible throughout the module
let prisma: PrismaClient;
globalThis.__dbConnected = false;

// Initialize database connection with retry logic
async function initializeDatabase() {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      console.log(`Attempting to connect to database (attempt ${retries + 1}/${MAX_RETRIES})...`);
      
      // Create a new instance of PrismaClient
      prisma = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ],
      });
      
      // Test connection with basic query
      await prisma.$queryRaw`SELECT 1 as result`;
      console.log('Database connection established successfully');
      
      // Verify tables exist
      try {
        await prisma.$queryRaw`SELECT COUNT(*) FROM "Location"`;
        console.log('Database schema verified - tables exist');
      } catch (tableError) {
        if (tableError.message && tableError.message.includes('relation') && tableError.message.includes('does not exist')) {
          console.warn('Database tables not found. This might be a first run.');
          console.warn('Running automatic database initialization...');
          
          // Initiate schema creation
          const { exec } = require('child_process');
          await new Promise((resolve, reject) => {
            exec('npx prisma migrate dev --name init', (error, stdout, stderr) => {
              if (error) {
                console.error('Failed to initialize database schema:', error);
                return reject(error);
              }
              console.log('Database initialization succeeded');
              resolve(true);
            });
          });
        } else {
          throw tableError;
        }
      }
      
      // Setup logging
      prisma.$on('error', (e) => {
        console.error('Prisma error:', e);
      });
      
      globalThis.__dbConnected = true;
      
      // Start the server once database is connected
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
      
      return prisma;
    } catch (error) {
      retries++;
      console.error(`Database connection failed (${retries}/${MAX_RETRIES}):`, error.message);
      
      if (retries < MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
        await setTimeout(RETRY_DELAY);
      } else {
        console.error(`Failed to connect to database after ${MAX_RETRIES} attempts`);
        throw error;
      }
    }
  }
}

// Wrap routes in a function that ensures database is initialized
async function setupRoutes() {
  // Get all locations
  app.get('/locations', async (req, res) => {
    try {
      if (!globalThis.__dbConnected) {
        console.error('GET /locations - Database connection not established');
        return res.status(503).json({ error: 'Database connection not established' });
      }
      
      console.log('GET /locations - Fetching all locations from database');
      
      // First check if the table exists
      try {
        const locationCount = await prisma.location.count();
        console.log(`Found ${locationCount} locations in database`);
        
        if (locationCount === 0) {
          console.log('No locations found in database, returning empty array');
          return res.json([]);
        }
        
        const locations = await prisma.location.findMany();
        
        // Log detailed information about the retrieved locations
        console.log(`Successfully retrieved ${locations.length} locations from database`);
        console.log(`Sample location data: ${JSON.stringify(locations[0], null, 2).substring(0, 300)}...`);
        
        // Add a validator to ensure all locations have required fields
        const validLocations = locations.filter(location => {
          if (!location.name || !location.coordinates || !location.type) {
            console.warn(`Invalid location data found: ${JSON.stringify(location, null, 2).substring(0, 300)}...`);
            return false;
          }
          return true;
        });
        
        if (validLocations.length !== locations.length) {
          console.warn(`Filtered out ${locations.length - validLocations.length} invalid locations`);
        }
        
        // Transform locations to match the expected format in the client
        const transformedLocations = validLocations.map(location => ({
          name: location.name,
          coordinates: location.coordinates,
          description: location.description,
          type: location.type,
          icon: location.icon,
          iconSize: location.iconSize,
          mediaUrl: location.mediaUrl,
          iconColor: location.iconColor,
          radius: location.radius,
          lastModified: location.lastModified.getTime(),
          isCoordinateSearch: location.isCoordinateSearch,
          lore: location.lore,
          spoilers: location.spoilers,
          noCluster: location.noCluster,
          _exactCoordinates: location.exactCoordinates
        }));
        
        console.log(`Sending ${transformedLocations.length} locations to client`);
        res.json(transformedLocations);
      } catch (tableError) {
        console.error('Error querying locations table:', tableError);
        
        // Check if this is a "relation does not exist" error
        if (tableError.message && tableError.message.includes('relation') && tableError.message.includes('does not exist')) {
          // If table doesn't exist, return empty array instead of error
          console.warn('Location table does not exist yet, returning empty array');
          res.json([]);
        } else {
          throw tableError;
        }
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
      res.status(500).json({ error: 'Failed to fetch locations', details: error.message });
    }
  });

  // Set up PostgreSQL LISTEN/NOTIFY for real-time updates
  app.get('/listen', async (req, res) => {
    try {
      if (!globalThis.__dbConnected) {
        return res.status(503).json({ error: 'Database connection not established' });
      }
      
      // Use EventSource / Server-Sent Events for real-time updates
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send initial message
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      
      try {
        // Set up Postgres LISTEN
        await prisma.$executeRaw`LISTEN location_changes`;
        console.log('Set up PostgreSQL LISTEN for location_changes channel');
        
        // Get access to underlying pg client
        // This is implementation-specific and may need adjustment based on Prisma version
        const client = await getPrismaClient();
        
        if (client) {
          console.log('Successfully acquired Postgres notification client');
          
          // Function to handle database notifications
          const handleNotification = (msg: any) => {
            console.log('Received Postgres notification:', msg);
            
            if (msg.channel === 'location_changes') {
              // Parse the payload if it's in JSON format
              let payload;
              try {
                payload = JSON.parse(msg.payload);
              } catch (e) {
                payload = { operation: 'unknown', data: msg.payload };
              }
              
              // Send notification to client
              res.write(`data: ${JSON.stringify({
                type: 'change',
                operation: payload.operation || 'update',
                table: payload.table || 'Location',
                id: payload.id,
                timestamp: Date.now()
              })}\n\n`);
            }
          };
          
          // Set up notification handler
          client.on('notification', handleNotification);
          
          // Clean up when client disconnects
          req.on('close', () => {
            client.removeListener('notification', handleNotification);
            console.log('Client disconnected from SSE');
          });
        } else {
          console.warn('Could not access underlying Postgres client for notifications');
          setupPollingFallback(res, req);
        }
      } catch (pgError) {
        console.error('Error setting up PostgreSQL LISTEN:', pgError);
        setupPollingFallback(res, req);
      }
    } catch (error) {
      console.error('Error setting up SSE:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Helper to access the underlying Postgres client
async function getPrismaClient() {
  try {
    // Try different methods to access the client based on Prisma version
    // Method 1: Direct access (works in some versions)
    if ((prisma as any)._engine?.client) {
      return (prisma as any)._engine.client;
    }
    
    // Method 2: Using $on with notification events (works in newer versions)
    const notificationHandler = (event: any) => {
      // This is just to test if notifications work
      console.log('Notification test:', event);
    };
    
    prisma.$on('notification', notificationHandler);
    
    // If we successfully set up a notification handler, we can try to access the client
    if ((prisma as any)._engine?.client) {
      return (prisma as any)._engine.client;
    }
    
    // Method 3: Use executeRaw to create a separate connection that supports LISTEN
    // This method is more complex and would require a separate connection pool
    
    return null;
  } catch (error) {
    console.error('Error accessing Postgres client:', error);
    return null;
  }
}

// Set up polling fallback if direct notifications aren't available
function setupPollingFallback(res: any, req: any) {
  console.log('Setting up polling fallback for real-time updates');
  
  // Set up polling fallback
  const pollInterval = setInterval(async () => {
    res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
  }, 30000); // Every 30 seconds
  
  req.on('close', () => {
    clearInterval(pollInterval);
    console.log('Client disconnected from polling fallback');
  });
}

// Initialize the app
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Setup routes
    await setupRoutes();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (prisma) {
    await prisma.$disconnect();
    console.log('Disconnected from database');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (prisma) {
    await prisma.$disconnect();
    console.log('Disconnected from database');
  }
  process.exit(0);
});

// Start the server
startServer();
