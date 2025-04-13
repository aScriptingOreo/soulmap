import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

// Get database connection string from environment
// This will already be loaded by other initialization scripts
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Create a connection pool
const pool = new Pool({
  connectionString,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test the connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('Database connection established successfully'))
  .catch(err => {
    console.error('Error connecting to database:', err);
  });

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

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

// Function to get a client from the pool
export async function getClient() {
  return await pool.connect();
}

// Helper function to query the database
export async function query(text: string, params?: any[]) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
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

// Function to set up LISTEN on a channel
export async function setupListener(channel: string, callback: (payload: string) => void) {
  const client = await pool.connect();
  
  try {
    // Set up notification listener
    client.on('notification', (msg) => {
      if (msg.channel === channel) {
        callback(msg.payload || '');
      }
    });
    
    // Listen for notifications on the specified channel
    await client.query(`LISTEN ${channel}`);
    console.log(`PostgreSQL LISTEN set up for channel: ${channel}`);
    
    // Return a cleanup function
    return () => {
      client.query(`UNLISTEN ${channel}`)
        .catch(err => console.error(`Error unlistening from channel ${channel}:`, err));
      client.release();
    };
  } catch (error) {
    client.release();
    console.error(`Error setting up listener for channel ${channel}:`, error);
    throw error;
  }
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

// Gracefully close all connections when the application exits
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
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
