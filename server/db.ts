import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

// Get database connection string from environment
// This will already be loaded by other initialization scripts
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Create a connection pool with improved resilience settings
const pool = new Pool({
  connectionString,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false, // Prevent closing when idle
  keepAlive: true, // Enable TCP keepalive
  keepAliveInitialDelayMillis: 10000, // Delay before first keepalive probe
});

// Test the connection on startup with retry mechanism
async function testDatabaseConnection(retries = 5, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('Database connection established successfully');
      return true;
    } catch (err) {
      console.error(`Connection attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries) {
        console.error('Maximum connection attempts reached. Server will continue but database features may not work.');
        return false;
      }
      // Exponential backoff delay
      const backoffDelay = delay * Math.pow(1.5, attempt - 1);
      console.log(`Retrying in ${Math.round(backoffDelay/1000)} seconds...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  return false;
}

// Start the connection test
testDatabaseConnection();

// Handle pool errors with reconnection logic
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  
  // For connection terminated errors, we may want to attempt recovery
  if (err.message.includes('terminated') || err.code === '57P01') {
    console.log('Database connection terminated, will attempt reconnection on next query');
  }
});

// Add a connection verification helper
async function verifyConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('Connection verification failed:', err.message);
    return false;
  }
}

// Singleton instance of PrismaClient for compatibility
let prismaInstance: PrismaClient | null = null;

// Compatibility function to get PrismaClient instance
export async function getPrismaClient(): Promise<PrismaClient | null> {
  if (!prismaInstance) {
    try {
      prismaInstance = new PrismaClient();
      await prismaInstance.$connect();
      console.log('Prisma client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Prisma client:', error);
      return null;
    }
  }
  return prismaInstance;
}

// Function to get a client from the pool with retry logic
export async function getClient(retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await pool.connect();
    } catch (err) {
      console.error(`Failed to get client (attempt ${attempt + 1}/${retries}):`, err.message);
      lastError = err;
      if (attempt < retries - 1) {
        // Delay before retry with exponential backoff
        const delay = Math.min(100 * Math.pow(2, attempt), 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Helper function to query the database with retry logic
export async function query(text: string, params?: any[], retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await pool.query(text, params);
      return result;
    } catch (error: any) {
      console.error(`Database query error (attempt ${attempt + 1}/${retries + 1}):`, error.message);
      lastError = error;
      
      // Check if this is a connection-level error that warrants a retry
      const isConnectionError = 
        error.code === 'ECONNREFUSED' || 
        error.code === '57P01' || // terminated by admin
        error.code === '08006' || // connection failure
        error.message.includes('terminating connection');
      
      if (!isConnectionError || attempt >= retries) {
        throw error;
      }
      
      // Wait before retrying with exponential backoff
      const delay = Math.min(200 * Math.pow(2, attempt), 3000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Function to get all locations
export async function getAllLocations() {
  const result = await query(`
    SELECT 
      id, name, coordinates, description, type, icon, 
      "iconSize", "mediaUrl", "iconColor", radius, 
      "lastModified", "isCoordinateSearch", lore, 
      spoilers, "noCluster", "exactCoordinates"
    FROM "Location"
    ORDER BY name ASC
  `);
  
  return result.rows;
}

// Function to get a location by id
export async function getLocationById(id: string) {
  const result = await query(
    'SELECT * FROM "Location" WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

// Function to generate a hash of the current database state
export async function generateDatabaseHash(): Promise<string> {
  try {
    // Get the latest update timestamp from the database
    const result = await query(`
      SELECT id, "updatedAt" 
      FROM "Location" 
      ORDER BY "updatedAt" DESC 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return `no-records-${Date.now()}`;
    }
    
    const latestUpdate = result.rows[0];
    return `${latestUpdate.id}-${new Date(latestUpdate.updatedAt).getTime()}`;
  } catch (error) {
    console.error('Error generating database hash:', error);
    return `error-${Date.now()}`;
  }
}

// Track active listeners to handle reconnection
const activeListeners: Map<string, {
  client: any, 
  callback: (payload: string) => void,
  active: boolean
}> = new Map();

// Function to set up LISTEN on a channel
export async function setupListener(channel: string, callback: (payload: string) => void) {
  // Check if we already have an active listener for this channel
  if (activeListeners.has(channel) && activeListeners.get(channel)?.active) {
    console.log(`Listener for channel ${channel} already exists, reusing`);
    // Update the callback in case it changed
    activeListeners.get(channel)!.callback = callback;
    return () => cleanupListener(channel);
  }

  try {
    // First verify if we can connect at all
    if (!await verifyConnection()) {
      console.warn(`Database connection unavailable, skipping listener setup for ${channel}`);
      return () => false; // Return dummy cleanup function
    }
    
    let client;
    try {
      client = await getClient();
      // Set up notification listener
      client.on('notification', (msg) => {
        if (msg.channel === channel) {
          callback(msg.payload || '');
        }
      });
      
      // Set up error handler for reconnection
      client.on('error', async (err) => {
        console.error(`Error on listener for channel ${channel}:`, err.message);
        if (activeListeners.has(channel)) {
          const listenerInfo = activeListeners.get(channel)!;
          if (listenerInfo.active) {
            listenerInfo.active = false;
            // Try to reconnect after a delay
            setTimeout(() => {
              reconnectListener(channel, callback);
            }, 5000);
          }
        }
      });
      
      // Listen for notifications on the specified channel
      await client.query(`LISTEN ${channel}`);
      console.log(`PostgreSQL LISTEN set up for channel: ${channel}`);
      
      // Store the listener information
      activeListeners.set(channel, { client, callback, active: true });
      
      // Return a cleanup function
      return () => cleanupListener(channel);
    } catch (error) {
      if (client) client.release();
      console.error(`Error setting up listener for channel ${channel}:`, error);
      
      // Don't schedule reconnection if the database is not available
      // Just return a no-op cleanup function
      return () => false;
    }
  } catch (error) {
    console.error(`Failed to setup listener for ${channel}:`, error.message);
    return () => false; // Return dummy cleanup function
  }
}

// Helper function to reconnect a listener
async function reconnectListener(channel: string, callback: (payload: string) => void) {
  console.log(`Attempting to reconnect listener for channel ${channel}`);
  try {
    // Clean up existing listener if it exists
    cleanupListener(channel);
    
    // Set up a new listener
    await setupListener(channel, callback);
  } catch (error) {
    console.error(`Failed to reconnect listener for channel ${channel}:`, error);
    // Try again after a delay
    setTimeout(() => {
      reconnectListener(channel, callback);
    }, 10000);
  }
}

// Helper function to clean up a listener
function cleanupListener(channel: string): boolean {
  if (activeListeners.has(channel)) {
    const listenerInfo = activeListeners.get(channel)!;
    try {
      if (listenerInfo.client) {
        listenerInfo.client.query(`UNLISTEN ${channel}`)
          .catch((err: any) => console.warn(`Error unlistening from channel ${channel}:`, err.message));
        listenerInfo.client.release();
      }
    } catch (error) {
      console.warn(`Error cleaning up listener for channel ${channel}:`, error);
    }
    
    activeListeners.delete(channel);
    return true;
  }
  return false;
}

// Function to send a NOTIFY
export async function sendNotification(channel: string, payload: string = '') {
  try {
    if (payload) {
      await query(`NOTIFY ${channel}, $1`, [payload]);
    } else {
      await query(`NOTIFY ${channel}`);
    }
    return true;
  } catch (error) {
    console.error(`Error sending notification to channel ${channel}:`, error);
    return false;
  }
}

// Setup a health check interval to detect disconnects
const healthCheckInterval = setInterval(async () => {
  try {
    // Verify the connection is healthy
    const connected = await verifyConnection();
    if (!connected) {
      console.warn('Health check failed, connection may be broken');
      
      // Check all active listeners
      for (const [channel, info] of activeListeners.entries()) {
        if (info.active) {
          console.log(`Reconnecting listener for channel ${channel} due to failed health check`);
          reconnectListener(channel, info.callback);
        }
      }
    }
  } catch (error) {
    console.error('Error during database health check:', error);
  }
}, 60000); // Check every minute

// Gracefully close all connections when the application exits
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
  clearInterval(healthCheckInterval);
  
  // Clean up all active listeners
  for (const channel of activeListeners.keys()) {
    cleanupListener(channel);
  }
  
  await pool.end();
  
  // Also disconnect Prisma if it was initialized
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    console.log('Prisma client disconnected');
  }
  
  console.log('Database pool closed');
  process.exit(0);
});

export default {
  query,
  getClient,
  getAllLocations,
  getLocationById,
  generateDatabaseHash,
  setupListener,
  sendNotification,
  getPrismaClient
};
