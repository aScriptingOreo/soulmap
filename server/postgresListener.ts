import { Client } from 'pg';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';

// Create a single notification event emitter
export const notificationEmitter = new EventEmitter();
notificationEmitter.setMaxListeners(100);

let pgClient: Client | null = null;
let connected = false;
let reconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_DELAY = 5000;

// Get connection string from environment or from prisma
function getConnectionString(prisma?: PrismaClient): string | null {
  // First try environment variable
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // Then try to extract it from prisma if provided
  if (prisma) {
    try {
      // This is hacky but might work to extract the connection string from prisma
      const prismaEngine = (prisma as any)._engine;
      if (prismaEngine && prismaEngine.url) {
        return prismaEngine.url;
      }
    } catch (error) {
      console.warn('Could not extract connection string from Prisma:', error);
    }
  }
  
  return null;
}

// Initialize the pg client and set up LISTEN
export async function setupPostgresListener(
  channelName: string = 'location_changes',
  prisma?: PrismaClient
): Promise<boolean> {
  // If already connected, don't reconnect
  if (connected) {
    return true;
  }

  // If already trying to reconnect, wait for that to finish
  if (reconnecting) {
    return false;
  }

  try {
    reconnecting = true;
    
    // Get connection string
    const connectionString = getConnectionString(prisma);
    if (!connectionString) {
      console.error('No connection string available for PostgreSQL listener');
      return false;
    }
    
    // Create a dedicated client for LISTEN
    pgClient = new Client({ connectionString });
    
    // Connect to postgres
    await pgClient.connect();
    console.log('PostgreSQL notification listener connected');
    
    // Listen for notifications
    await pgClient.query(`LISTEN ${channelName}`);
    console.log(`Now listening on channel: ${channelName}`);
    
    // Set up notification handler
    pgClient.on('notification', (msg) => {
      console.log(`PostgreSQL notification received on channel ${msg.channel}:`, msg.payload);
      notificationEmitter.emit('db-change', {
        type: 'change',
        source: 'postgres-notification',
        timestamp: Date.now(),
        payload: msg.payload,
        channel: msg.channel
      });
    });
    
    // Handle client errors
    pgClient.on('error', (err) => {
      console.error('PostgreSQL notification client error:', err);
      handleDisconnect();
    });
    
    // Handle client disconnection
    pgClient.on('end', () => {
      console.log('PostgreSQL notification client disconnected');
      handleDisconnect();
    });
    
    connected = true;
    reconnecting = false;
    reconnectAttempts = 0;
    return true;
  } catch (error) {
    console.error('Error setting up PostgreSQL listener:', error);
    reconnecting = false;
    handleDisconnect();
    return false;
  }
}

// Handle client disconnection and reconnect
function handleDisconnect() {
  connected = false;
  
  // Clean up existing client
  if (pgClient) {
    try {
      pgClient.end();
    } catch (e) {
      // Ignore end errors
    }
    pgClient = null;
  }
  
  // Attempt to reconnect with exponential backoff
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), 60000);
    
    console.log(`Reconnecting to PostgreSQL in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
      setupPostgresListener().catch(error => {
        console.error(`Reconnect attempt ${reconnectAttempts} failed:`, error);
      });
    }, delay);
  } else {
    console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
  }
}

// Function to explicitly send a notification (for manual triggers)
export async function sendNotification(
  channelName: string = 'location_changes',
  payload: string = ''
): Promise<boolean> {
  if (!pgClient || !connected) {
    console.error('PostgreSQL notification client not connected');
    return false;
  }
  
  try {
    // Use parameterized query for safety
    const query = payload 
      ? `NOTIFY ${channelName}, $1`
      : `NOTIFY ${channelName}`;
      
    const params = payload ? [payload] : [];
    
    await pgClient.query(query, params);
    console.log(`Notification sent on channel ${channelName}`);
    return true;
  } catch (error) {
    console.error('Error sending PostgreSQL notification:', error);
    return false;
  }
}

// Close the connection gracefully
export async function closePostgresListener(): Promise<void> {
  if (pgClient) {
    try {
      await pgClient.end();
      console.log('PostgreSQL notification listener closed');
    } catch (error) {
      console.error('Error closing PostgreSQL listener:', error);
    }
    pgClient = null;
  }
  connected = false;
}

// Ensure the connection is closed when the process exits
process.on('beforeExit', () => {
  closePostgresListener().catch(() => {});
});

process.on('SIGINT', () => {
  closePostgresListener().catch(() => {});
});

process.on('SIGTERM', () => {
  closePostgresListener().catch(() => {});
});
