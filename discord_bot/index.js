const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { initializeDatabase, saveRequest, updateRequestStatus, getRequestsByStatus, getAllRequests, 
        getContributorLeaderboard, getLeaderboardInfo, setLeaderboardInfo, deleteRequestByMessageId,
        searchLocationsForAutocomplete, getRequestByMessageId, getRequestById, undoRequest, columnExists } = require('./database');
const { PrismaClient } = require('@prisma/client');
const { setupEventHandlers } = require('./handlers/eventHandler');
const { registerCommands } = require('./handlers/commandRegistration');
const { handleModalSubmit } = require('./handlers/modalHandler');
// Import the new EditSessionManager class
const EditSessionManager = require('./classes/EditSessionManager');

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize database connection early
let dbInitialized = false;
console.log('Attempting to initialize database...');
initializeDatabase().then(() => {
  dbInitialized = true;
  console.log('Database initialization promise resolved successfully.');
}).catch(err => {
  console.error('Failed to initialize database:', err);
  // The bot might not function correctly if the database connection fails.
});

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Get environment variables with validation
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;

// Validate required environment variables
if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN environment variable is not set.');
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.warn('WARNING: CHANNEL_ID environment variable is not set. Request submissions will not work.');
}

if (!ADMIN_ROLE_ID) {
  console.warn('WARNING: ADMIN_ROLE_ID environment variable is not set. Admin permissions will not work correctly.');
}

if (!LEADERBOARD_CHANNEL_ID) {
  console.warn('WARNING: LEADERBOARD_CHANNEL_ID environment variable is not set. Leaderboard functionality will be disabled.');
}

// Function to notify the web application of database changes
async function notifyDatabaseChange() {
  try {
    await prisma.$executeRaw`NOTIFY location_changes`;
    console.log('Notified application of database changes');
  } catch (error) {
    console.error('Failed to notify about database changes:', error);
  }
}

// Create a new EditSessionManager instance
const editSessionManager = new EditSessionManager({
  searchLocationsForAutocomplete,
  saveRequest,
  getRequestByMessageId
});

// Collect database-related functions to pass to handlers
const dbFunctions = {
  saveRequest,
  updateRequestStatus,
  getRequestsByStatus,
  getAllRequests,
  getContributorLeaderboard,
  getLeaderboardInfo,
  setLeaderboardInfo,
  deleteRequestByMessageId,
  notifyDatabaseChange,
  searchLocationsForAutocomplete,
  handleModalSubmit,
  getRequestByMessageId,
  getRequestById,
  undoRequest,
  columnExists,
  // Replace individual session functions with editSessionManager methods
  getEditSession: (userId, markerId) => editSessionManager.getSession(userId, markerId),
  saveEditSession: (userId, markerId, markerName, edits) => editSessionManager.saveSession(userId, markerId, markerName, edits),
  deleteEditSession: (userId, markerId) => editSessionManager.deleteSession(userId, markerId),
  createSessionFromRequest: (userId, messageId, isAdmin) => editSessionManager.createSessionFromRequest(userId, messageId, isAdmin),
  saveEditSessionAsRequest: (messageId, userId, markerId, markerName, reason) => 
    editSessionManager.saveSessionAsRequest(messageId, userId, markerId, reason),
  // Add new methods
  editSessionManager: editSessionManager
};

// Collect configuration to pass to handlers
const config = {
  TOKEN,
  CHANNEL_ID,
  ADMIN_ROLE_ID,
  LEADERBOARD_CHANNEL_ID
};

// Register event handlers
setupEventHandlers(client, prisma, dbFunctions, config);

// Register slash commands when bot is ready
client.once('ready', async () => {
  try {
    await registerCommands(client, TOKEN);
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

// Add graceful shutdown handler for Prisma
async function closeDatabase() {
  await prisma.$disconnect();
  console.log('Prisma client disconnected.');
}

process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing database connection...');
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing database connection...');
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Login with token
client.login(TOKEN).catch(error => {
  console.error('Failed to login:', error);
});
