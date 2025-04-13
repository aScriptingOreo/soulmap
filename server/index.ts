import express from 'express';
import cors from 'cors';
import { setTimeout } from 'timers/promises';
import path from 'path';
import { EventEmitter } from 'events';
import db from './db';
import { 
  setupPostgresListener, 
  notificationEmitter, 
  sendNotification,
  closePostgresListener
} from './postgresListener';

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

// Improved database hash generation
async function generateDatabaseHash(): Promise<string> {
  try {
    // Get a Prisma client
    const prisma = await getPrismaClient();
    
    if (!prisma) {
      console.warn('No valid Prisma client available for hash generation');
      return `error-no-client-${Date.now()}`;
    }
    
    // Get the latest updated location's ID and timestamp
    const latestUpdate = await prisma.location.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, updatedAt: true },
    });
    
    if (!latestUpdate) {
      return `error-no-data-${Date.now()}`;
    }
    
    // Use a combination of ID and timestamp for a stable hash
    const hashBase = `${latestUpdate.id}-${latestUpdate.updatedAt.getTime()}`;
    return hashBase;
  } catch (error) {
    console.error('Error generating database hash:', error);
    return `error-${Date.now()}`;
  }
}

// Replace the location hash endpoint with a more stable implementation
app.get('/locations/hash', async (req, res) => {
  try {
    const hash = await generateDatabaseHash();
    res.json({ hash });
  } catch (error) {
    console.error('Error generating hash:', error);
    res.status(500).json({ error: 'Failed to generate hash', hash: `error-${Date.now()}` });
  }
});

// Create a single shared event emitter for database notifications
const dbNotifier = new EventEmitter();
// Set a reasonable max listeners limit
dbNotifier.setMaxListeners(100);

// Track active SSE connections to properly clean up
const activeConnections = new Set<Response>();

// Start with a clean listener state
let listenerSetupComplete = false;

// Centralized notification handler using our dedicated PostgreSQL listener
async function initializeNotifications() {
  if (listenerSetupComplete) return;
  
  try {
    console.log('Setting up PostgreSQL LISTEN for database changes...');
    
    // Get a Prisma client for connection details
    const prisma = await getPrismaClient();
    
    // Set up the dedicated PostgreSQL listener
    const success = await setupPostgresListener('location_changes', prisma);
    
    if (success) {
      console.log('PostgreSQL LISTEN setup complete');
      
      // Forward PostgreSQL notifications to the dbNotifier
      notificationEmitter.on('db-change', (data) => {
        console.log('Forwarding PostgreSQL notification to clients');
        dbNotifier.emit('db-change', data);
      });
      
      listenerSetupComplete = true;
    } else {
      console.log('Failed to set up PostgreSQL LISTEN, falling back to polling');
      startPollingFallback();
    }
  } catch (error) {
    console.error('Error setting up PostgreSQL LISTEN:', error);
    console.log('Falling back to polling mechanism');
    startPollingFallback();
  }
}

// Polling fallback mechanism for when direct notification doesn't work
let pollingInterval: NodeJS.Timeout | null = null;
let lastKnownHash: string | null = null;
let consecutiveHashFailures = 0;
const MAX_HASH_FAILURES = 3;
const POLLING_INTERVAL = 30000; // 30 seconds - much less aggressive

function startPollingFallback() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  console.log('Setting up polling fallback for real-time updates');
  
  // Start with an initial hash check
  generateDatabaseHash().then(hash => {
    lastKnownHash = hash;
    console.log(`Initial database hash: ${hash}`);
  });
  
  // Check every 30 seconds for changes - only as a fallback
  pollingInterval = setInterval(async () => {
    try {
      // Only check if we have active connections and Postgres listener failed
      if (activeConnections.size > 0) {
        const currentHash = await generateDatabaseHash();
        
        // Only detect changes if the hash is valid and different
        if (lastKnownHash && currentHash && currentHash !== lastKnownHash) {
          // Double-check with a second hash to confirm (prevents false positives)
          const confirmationHash = await generateDatabaseHash();
          
          if (confirmationHash === currentHash && confirmationHash !== lastKnownHash) {
            console.log(`Database change detected via polling: ${lastKnownHash} → ${currentHash}`);
            lastKnownHash = currentHash;
            consecutiveHashFailures = 0;
            
            // Broadcast change to all listeners
            dbNotifier.emit('db-change', { 
              type: 'change', 
              timestamp: Date.now(),
              source: 'polling'
            });
          } else {
            console.log('Ignoring potential false positive hash change');
          }
        } else {
          // Send ping events only occasionally to keep connections alive
          if (Math.random() > 0.7) { // ~30% chance to send ping
            dbNotifier.emit('db-ping', { 
              type: 'ping', 
              timestamp: Date.now() 
            });
          }
        }
      }
    } catch (error) {
      console.error('Error in polling fallback:', error);
      consecutiveHashFailures++;
      
      // If we have too many consecutive failures, reset the hash
      if (consecutiveHashFailures >= MAX_HASH_FAILURES) {
        console.log('Too many hash generation failures, resetting last known hash');
        lastKnownHash = null;
        consecutiveHashFailures = 0;
      }
    }
  }, POLLING_INTERVAL);
}

// Initialize database connection with retry logic
async function initializeDatabase() {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      console.log(`Attempting to connect to database (attempt ${retries + 1}/${MAX_RETRIES})...`);
      
      // Create a new instance of PrismaClient
      const prisma = await db.getPrismaClient();
      
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
    console.log('GET /locations - Fetching all locations from database');
    
    try {
      const locations = await db.getAllLocations();
      
      // Transform data if needed (e.g., parse JSON fields)
      const transformedLocations = locations.map(loc => ({
        ...loc,
        coordinates: typeof loc.coordinates === 'string' ? JSON.parse(loc.coordinates) : loc.coordinates,
        mediaUrl: typeof loc.mediaUrl === 'string' ? JSON.parse(loc.mediaUrl) : loc.mediaUrl,
        exactCoordinates: typeof loc.exactCoordinates === 'string' ? JSON.parse(loc.exactCoordinates) : loc.exactCoordinates
      }));
      
      console.log(`Found ${transformedLocations.length} locations in database`);
      console.log(`Successfully retrieved ${transformedLocations.length} locations from database`);
      console.log(`Sending ${transformedLocations.length} locations to client`);
      
      res.json(transformedLocations);
    } catch (error) {
      console.error('Error fetching locations:', error);
      res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  // Update the SSE endpoint to use our improved notification system
  app.get('/listen', async (req, res) => {
    console.log('GET /listen');
    
    // Initialize the PostgreSQL listener if not already done
    await initializeNotifications();
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Helper function to send data to the client
    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send initial connection message
    sendEvent({ type: 'connected', timestamp: Date.now() });
    
    // Add this client to active connections
    activeConnections.add(res);
    console.log(`Client connected to SSE. Active connections: ${activeConnections.size}`);
    
    // Listen for database changes
    const changeListener = (data: any) => {
      sendEvent(data);
    };
    
    // Listen for ping events (keep-alive)
    const pingListener = (data: any) => {
      sendEvent(data);
    };
    
    // Add event listeners
    dbNotifier.on('db-change', changeListener);
    dbNotifier.on('db-ping', pingListener);
    
    // Handle client disconnection
    req.on('close', () => {
      dbNotifier.off('db-change', changeListener);
      dbNotifier.off('db-ping', pingListener);
      activeConnections.delete(res);
      console.log(`Client disconnected from SSE. Active connections: ${activeConnections.size}`);
    });
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

// Add this function to trigger a notification when locations change
export async function notifyDatabaseChange(): Promise<boolean> {
  try {
    // Use the dedicated PostgreSQL notification sender
    const success = await sendNotification('location_changes');
    
    // As a fallback, also emit the event on our local notifier
    if (!success) {
      dbNotifier.emit('db-change', {
        type: 'change',
        timestamp: Date.now(),
        source: 'manual'
      });
    }
    
    return true;
  } catch (error) {
    console.error('Failed to notify about database changes:', error);
    return false;
  }
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
  console.log('Shutting down gracefully...');
  await closePostgresListener();
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  // Close all active connections
  for (const conn of activeConnections) {
    try {
      conn.end();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await closePostgresListener();
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  // Close all active connections
  for (const conn of activeConnections) {
    try {
      conn.end();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  
  process.exit(0);
});

// Start the server
startServer();
