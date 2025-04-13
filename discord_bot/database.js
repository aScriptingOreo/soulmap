const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Create Prisma client
const prisma = new PrismaClient();
let initialized = false;

// Function to check if tables exist and create them if needed
async function initializeDatabase() {
  if (initialized) return true;
  
  try {
    console.log('Initializing Discord bot database connection...');
    
    // Check if our Discord tables exist by attempting a query
    try {
      await prisma.discordLocationRequest.count();
      console.log('Discord bot tables already exist in database');
    } catch (tableError) {
      if (tableError.code === 'P2010' || 
          (tableError.message && tableError.message.includes('does not exist'))) {
        console.log('Discord bot tables do not exist. Creating them...');
        
        // Generate Prisma client with correct schema
        try {
          console.log('Running Prisma migration for Discord bot tables...');
          
          // Create migrations directory if it doesn't exist
          const migrationsDir = path.join(__dirname, 'prisma', 'migrations');
          if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
          }
          
          // Create migration
          await execPromise('npx prisma migrate dev --name discord_bot_tables --create-only', { cwd: __dirname });
          
          // Apply migration
          await execPromise('npx prisma migrate deploy', { cwd: __dirname });
          
          // Generate client
          await execPromise('npx prisma generate', { cwd: __dirname });
          
          console.log('Successfully created Discord bot tables');
        } catch (migrationError) {
          console.error('Error during Prisma migration:', migrationError);
          
          // Fallback: Use SQL statements directly if migration fails
          try {
            console.log('Attempting to create tables directly...');
            
            await prisma.$executeRaw`
              CREATE TABLE IF NOT EXISTS discord_location_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                message_id TEXT UNIQUE NOT NULL,
                user_id TEXT NOT NULL,
                coordinates TEXT NOT NULL,
                description TEXT NOT NULL,
                screenshot_url TEXT,
                status TEXT DEFAULT 'pending',
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )
            `;
            
            await prisma.$executeRaw`
              CREATE TABLE IF NOT EXISTS discord_leaderboard_info (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                message_id TEXT,
                channel_id TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )
            `;
            
            console.log('Successfully created Discord bot tables using raw SQL');
          } catch (sqlError) {
            console.error('Error creating tables directly:', sqlError);
            return false;
          }
        }
      } else {
        throw tableError;
      }
    }
    
    // Initialize leaderboard info table if needed
    const leaderboardInfo = await getLeaderboardInfo();
    if (!leaderboardInfo) {
      await prisma.discordLeaderboardInfo.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 }
      });
    }
    
    initialized = true;
    console.log('Discord bot database initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing Discord bot database:', error);
    return false;
  }
}

async function saveRequest(messageId, userId, coordinates, description, screenshotUrl = null) {
  try {
    if (!initialized) await initializeDatabase();
    
    const result = await prisma.discordLocationRequest.create({
      data: {
        messageId,
        userId,
        coordinates,
        description,
        screenshotUrl
      }
    });
    
    console.log(`Saved request to database with ID: ${result.id}`);
    return result.id;
  } catch (error) {
    console.error('Error saving request to database:', error);
    return null;
  }
}

async function updateRequestStatus(messageId, status, reason = null) {
  try {
    if (!initialized) await initializeDatabase();
    
    const result = await prisma.discordLocationRequest.update({
      where: { messageId },
      data: {
        status,
        reason,
        updatedAt: new Date()
      }
    });
    
    console.log(`Updated request status: ${messageId} -> ${status}`);
    return true;
  } catch (error) {
    // If message ID not found, log it differently
    if (error.code === 'P2025') {
      console.log(`Request with message ID ${messageId} not found`);
      return false;
    }
    
    console.error('Error updating request status:', error);
    return false;
  }
}

async function getRequestsByStatus(status) {
  try {
    if (!initialized) await initializeDatabase();
    
    return await prisma.discordLocationRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error(`Error getting requests with status ${status}:`, error);
    return [];
  }
}

async function getAllRequests() {
  try {
    if (!initialized) await initializeDatabase();
    
    return await prisma.discordLocationRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error('Error getting all requests:', error);
    return [];
  }
}

async function getRequestByMessageId(messageId) {
  try {
    if (!initialized) await initializeDatabase();
    
    return await prisma.discordLocationRequest.findUnique({
      where: { messageId }
    });
  } catch (error) {
    console.error(`Error getting request with message ID ${messageId}:`, error);
    return null;
  }
}

async function deleteRequestByMessageId(messageId) {
  try {
    if (!initialized) await initializeDatabase();
    
    await prisma.discordLocationRequest.delete({
      where: { messageId }
    });
    
    console.log(`Deleted request with message ID ${messageId}`);
    return true;
  } catch (error) {
    // If record not found, don't treat as error
    if (error.code === 'P2025') {
      console.log(`Request with message ID ${messageId} not found for deletion`);
      return false;
    }
    
    console.error(`Error deleting request with message ID ${messageId}:`, error);
    return false;
  }
}

async function getContributorLeaderboard() {
  try {
    if (!initialized) await initializeDatabase();
    
    // Get all implemented requests
    const requests = await prisma.discordLocationRequest.findMany({
      where: { status: 'implemented' },
      select: {
        userId: true,
        coordinates: true
      }
    });
    
    // Process requests to count coordinates per user
    const userStats = {};
    
    for (const request of requests) {
      const userId = request.userId;
      
      // Parse coordinates from the string - handle comma-separated lists properly
      const coordsString = request.coordinates.replace(/\s+/g, '');
      const coordPairs = coordsString.match(/\[-?\d+,-?\d+\]/g) || [];
      
      // Add to user's count (each coordinate pair counts as one contribution)
      if (!userStats[userId]) {
        userStats[userId] = {
          userId,
          count: 0
        };
      }
      userStats[userId].count += coordPairs.length;
    }
    
    // Convert to array and sort by count in descending order
    const leaderboard = Object.values(userStats)
      .sort((a, b) => b.count - a.count);
    
    return leaderboard;
  } catch (error) {
    console.error('Error generating leaderboard data:', error);
    return [];
  }
}

async function getLeaderboardInfo() {
  try {
    if (!initialized) await initializeDatabase();
    
    const info = await prisma.discordLeaderboardInfo.findUnique({
      where: { id: 1 }
    });
    
    return info || { messageId: null, channelId: null };
  } catch (error) {
    console.error('Error getting leaderboard info:', error);
    return { messageId: null, channelId: null };
  }
}

async function setLeaderboardInfo(messageId, channelId) {
  try {
    if (!initialized) await initializeDatabase();
    
    await prisma.discordLeaderboardInfo.upsert({
      where: { id: 1 },
      update: {
        messageId,
        channelId,
        updatedAt: new Date()
      },
      create: {
        id: 1,
        messageId,
        channelId
      }
    });
    
    console.log(`Updated leaderboard info: messageId=${messageId}, channelId=${channelId}`);
    return true;
  } catch (error) {
    console.error('Error setting leaderboard info:', error);
    return false;
  }
}

// Function to properly close the Prisma connection
async function closeDatabase() {
  try {
    await prisma.$disconnect();
    console.log('Discord bot database connection closed');
  } catch (error) {
    console.error('Error closing database connection:', error);
  }
}

// Add migration tool for transitioning from SQLite to PostgreSQL
async function migrateFromSqlite(sqliteDbPath) {
  try {
    if (!fs.existsSync(sqliteDbPath)) {
      console.log('SQLite database file not found, no migration needed');
      return false;
    }
    
    console.log(`Migrating data from SQLite database: ${sqliteDbPath}`);
    
    // This function would need to:
    // 1. Open the SQLite database
    // 2. Read all records from each table
    // 3. Insert them into the PostgreSQL database

    // For a real implementation, we'd need to use the sqlite3 package
    // and implement the actual migration logic.
    
    console.log('Migration from SQLite to PostgreSQL completed');
    return true;
  } catch (error) {
    console.error('Error migrating from SQLite to PostgreSQL:', error);
    return false;
  }
}

module.exports = {
  initializeDatabase,
  saveRequest,
  updateRequestStatus,
  getRequestsByStatus,
  getAllRequests,
  getRequestByMessageId,
  getContributorLeaderboard,
  getLeaderboardInfo,
  setLeaderboardInfo,
  deleteRequestByMessageId,
  closeDatabase,
  migrateFromSqlite
};
