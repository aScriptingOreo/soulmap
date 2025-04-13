const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Simple initialization with schema validation and auto-creation
async function initializeDatabase() {
  console.log('Initializing Discord bot database connection...');
  try {
    // Test the connection
    await prisma.$connect();
    console.log('Database connection successful.');

    // Check and initialize database schema
    await validateAndEnsureSchema();

    // Ensure the single leaderboard info record exists
    await prisma.discordLeaderboardInfo.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, messageId: null, channelId: null },
    });
    console.log('Ensured leaderboard info record exists.');

  } catch (error) {
    console.error('Error connecting to or initializing database:', error);
    // Re-throw the error to be caught by the caller in index.js
    throw error;
  }
}

/**
 * Validate and ensure database schema exists
 * This replaces the separate migration script
 */
async function validateAndEnsureSchema() {
  console.log('Validating database schema...');
  
  try {
    // Check if required tables exist
    const tables = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'`;
    
    const tableNames = tables.map(t => t.tablename);
    console.log('Existing tables:', tableNames);
    
    // Check and create discord_location_requests table if needed
    if (!tableNames.includes('discord_location_requests')) {
      console.log('Creating discord_location_requests table...');
      await prisma.$executeRaw`
        CREATE TABLE "discord_location_requests" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "message_id" TEXT UNIQUE NOT NULL,
          "user_id" TEXT NOT NULL,
          "request_type" TEXT NOT NULL DEFAULT 'new',
          "reason" TEXT,
          "current_data" TEXT,
          "new_data" TEXT,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "approved_by" TEXT,
          "approved_at" TIMESTAMP,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP NOT NULL DEFAULT now()
        )`;
      console.log('Created discord_location_requests table');
    } else {
      // Table exists, check if all required columns exist
      const columns = await prisma.$queryRaw`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'discord_location_requests'`;
      
      const columnNames = columns.map(col => col.column_name);
      console.log('discord_location_requests columns:', columnNames);
      
      // Define required columns
      const requiredColumns = {
        // Core fields
        'message_id': 'TEXT UNIQUE NOT NULL',
        'user_id': 'TEXT NOT NULL',
        'request_type': 'TEXT NOT NULL DEFAULT \'new\'',
        'reason': 'TEXT',
        
        // JSON data fields
        'current_data': 'TEXT',
        'new_data': 'TEXT',
        
        // Status fields
        'status': 'TEXT NOT NULL DEFAULT \'pending\'',
        'approved_by': 'TEXT',
        'approved_at': 'TIMESTAMP',
        
        // Timestamps
        'created_at': 'TIMESTAMP NOT NULL DEFAULT now()',
        'updated_at': 'TIMESTAMP NOT NULL DEFAULT now()'
      };
      
      // Add any missing columns
      for (const [column, definition] of Object.entries(requiredColumns)) {
        if (!columnNames.includes(column)) {
          console.log(`Adding ${column} column...`);
          await prisma.$executeRaw`ALTER TABLE "discord_location_requests" ADD COLUMN ${prisma.raw(`"${column}" ${definition}`)}`; 
        }
      }
    }
    
    // Check and create discord_leaderboard_info table if needed
    if (!tableNames.includes('discord_leaderboard_info')) {
      console.log('Creating discord_leaderboard_info table...');
      await prisma.$executeRaw`
        CREATE TABLE "discord_leaderboard_info" (
          "id" INTEGER PRIMARY KEY,
          "message_id" TEXT,
          "channel_id" TEXT,
          "updated_at" TIMESTAMP NOT NULL DEFAULT now()
        )`;
      console.log('Created discord_leaderboard_info table');
    }
    
    console.log('Schema validation complete');
  } catch (error) {
    console.error('Error validating database schema:', error);
    throw error;
  }
}

// Updated function to get leaderboard info from the database
async function getLeaderboardInfo() {
  console.log('getLeaderboardInfo called');
  try {
    const info = await prisma.discordLeaderboardInfo.findUnique({
      where: { id: 1 }, // Assuming a single row with id 1
    });
    
    // Transform the result to have consistent property names (snake_case)
    // This ensures backward compatibility with the rest of the code
    if (info) {
      return {
        message_id: info.messageId, // Convert from camelCase to snake_case
        channel_id: info.channelId  // Convert from camelCase to snake_case
      };
    }
    
    // Return default values if no record found
    return { message_id: null, channel_id: null };
  } catch (error) {
    console.error('Error fetching leaderboard info from database:', error);
    return { message_id: null, channel_id: null }; // Return default on error
  }
}

// Updated function to set leaderboard info in the database
async function setLeaderboardInfo(messageId, channelId) {
  console.log(`setLeaderboardInfo called with messageId: ${messageId}, channelId: ${channelId}`);
  try {
    await prisma.discordLeaderboardInfo.upsert({
      where: { id: 1 }, // Assuming a single row with id 1
      update: { messageId: messageId, channelId: channelId },
      create: { id: 1, messageId: messageId, channelId: channelId },
    });
    console.log('Leaderboard info updated in database.');
  } catch (error) {
    console.error('Error saving leaderboard info to database:', error);
  }
}

/**
 * Save a request to the database with JSON data
 */
async function saveRequest(messageId, userId, requestType = 'new', reason = '', options = {}) {
  console.log(`Saving request: messageId=${messageId}, userId=${userId}, type=${requestType}`);
  try {
    const { currentData, newData } = options;
    
    // Build basic request data
    const requestData = {
      message_id: messageId,
      user_id: userId,
      request_type: requestType,
      reason: reason || '',
      status: 'pending'
    };
    
    // Add JSON data if provided
    if (currentData) {
      requestData.current_data = typeof currentData === 'string' ? 
        currentData : JSON.stringify(currentData);
    }
    
    if (newData) {
      requestData.new_data = typeof newData === 'string' ? 
        newData : JSON.stringify(newData);
    }
    
    // Build the SQL for insertion
    const columns = Object.keys(requestData).map(key => `"${key}"`).join(', ');
    const placeholders = Object.keys(requestData).map((_, i) => `$${i + 1}`).join(', ');
    const values = Object.values(requestData);
    
    // Execute the insertion
    await prisma.$executeRawUnsafe(
      `INSERT INTO discord_location_requests (${columns}) VALUES (${placeholders})`,
      ...values
    );
    
    console.log('Request saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving request:', error);
    
    // Simple fallback with essential fields
    try {
      console.log('Attempting fallback with minimal fields...');
      await prisma.$executeRaw`
        INSERT INTO discord_location_requests (message_id, user_id, request_type)
        VALUES (${messageId}, ${userId}, ${requestType})
      `;
      console.log('Fallback request saved successfully');
      return true;
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      return false;
    }
  }
}

// In-memory edit session cache
const editSessionCache = new Map();
const EDIT_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Get an edit session from in-memory cache
 */
async function getEditSession(userId, markerId) {
  console.log(`Getting edit session for user ${userId}, marker ${markerId}`);
  try {
    const cacheKey = `${userId}_${markerId}`;
    const session = editSessionCache.get(cacheKey);
    
    if (session) {
      // Update last accessed time
      session.lastAccessed = Date.now();
      editSessionCache.set(cacheKey, session);
      console.log('Found edit session in cache');
      return session;
    }
    
    console.log('No edit session found in cache');
    return { edits: {} }; // Return empty edits object instead of null
  } catch (error) {
    console.error('Error getting edit session from cache:', error);
    return { edits: {} }; // Return empty edits object on error
  }
}

/**
 * Save edit session to in-memory cache
 */
async function saveEditSession(userId, markerId, markerName, edits) {
  console.log(`Saving edit session for user ${userId}, marker ${markerId}`);
  try {
    const cacheKey = `${userId}_${markerId}`;
    const session = {
      userId,
      markerId,
      markerName,
      edits,
      created: editSessionCache.get(cacheKey)?.created || Date.now(),
      lastAccessed: Date.now()
    };
    
    editSessionCache.set(cacheKey, session);
    console.log('Edit session saved to cache');
    return true;
  } catch (error) {
    console.error('Error saving edit session to cache:', error);
    return false;
  }
}

/**
 * Delete an edit session from in-memory cache
 */
async function deleteEditSession(userId, markerId) {
  console.log(`Deleting edit session for user ${userId}, marker ${markerId}`);
  try {
    const cacheKey = `${userId}_${markerId}`;
    const deleted = editSessionCache.delete(cacheKey);
    console.log(`Edit session ${deleted ? 'deleted from' : 'not found in'} cache`);
    return true;
  } catch (error) {
    console.error('Error deleting edit session from cache:', error);
    return false;
  }
}

/**
 * Clean up expired edit sessions
 */
function cleanupEditSessions() {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [key, session] of editSessionCache.entries()) {
    if (now - session.lastAccessed > EDIT_SESSION_TIMEOUT) {
      editSessionCache.delete(key);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired edit sessions`);
  }
}

// Set up periodic cleanup
setInterval(cleanupEditSessions, 5 * 60 * 1000); // Run every 5 minutes

async function updateRequestStatus(messageId, status) {
  console.log('updateRequestStatus called (stub)');
  // Example: await prisma.discordLocationRequest.update({ where: { messageId: messageId }, data: { status } });
}

async function getRequestsByStatus(status) {
  console.log('getRequestsByStatus called (stub)');
  try {
    // Implement the actual query when ready
    // return await prisma.discordLocationRequest.findMany({ where: { status } });
    
    // For now, return an empty array to ensure correct type
    return [];
  } catch (error) {
    console.error('Error in getRequestsByStatus:', error);
    return []; // Always return array
  }
}

async function getAllRequests() {
  console.log('getAllRequests called (stub)');
  try {
    // Implement the actual query when ready
    // return await prisma.discordLocationRequest.findMany();
    
    // For now, return an empty array to ensure correct type
    return [];
  } catch (error) {
    console.error('Error in getAllRequests:', error);
    return []; // Always return array
  }
}

async function getContributorLeaderboard() {
  console.log('getContributorLeaderboard called (stub)');
  // Example: return await prisma.discordLocationRequest.groupBy({ by: ['userId'], _count: { userId: true }, where: { status: 'implemented' } });
  // Adjust based on how contributions are tracked (e.g., using Location.approvedBy)
  return [];
}

async function deleteRequestByMessageId(messageId) {
  console.log('deleteRequestByMessageId called (stub)');
  // Example: await prisma.discordLocationRequest.delete({ where: { messageId: messageId } });
}

/**
 * Get request by ID
 */
async function getRequestById(requestId) {
  console.log(`Getting request by ID: ${requestId}`);
  try {
    const request = await prisma.discordLocationRequest.findUnique({
      where: { id: requestId }
    });
    return request;
  } catch (error) {
    console.error('Error getting request by ID:', error);
    return null;
  }
}

/**
 * Get edit request by message ID with safe handling of missing columns
 */
async function getRequestByMessageId(messageId) {
  try {
    // Use raw SQL to avoid Prisma schema validation issues
    const requests = await prisma.$queryRaw`
      SELECT * FROM discord_location_requests 
      WHERE message_id = ${messageId}
    `;
    
    if (!requests || requests.length === 0) {
      return null;
    }
    
    return requests[0];
  } catch (error) {
    console.error('Error fetching request by message ID:', error);
    return null;
  }
}

/**
 * Create a new edit session based on an existing request
 * This can be used by both admins and the original requester
 */
async function createSessionFromRequest(userId, messageId, isAdmin = false) {
  console.log(`Creating edit session for user ${userId} from request ${messageId}`);
  try {
    const request = await getRequestByMessageId(messageId);
    
    if (!request) {
      console.error(`Request with message ID ${messageId} not found`);
      return null;
    }
    
    // Check permissions - only admins or the original requester can edit
    if (!isAdmin && request.user_id !== userId) {
      console.error(`User ${userId} is not authorized to edit request from user ${request.user_id}`);
      return null;
    }
    
    let edits = {};
    
    // Try to get edits from the request data - preferring current_data/new_data if available
    if (request.new_data) {
      try {
        // If new_data exists, use it as the basis for the edit session
        const newData = JSON.parse(request.new_data);
        const currentData = request.current_data ? JSON.parse(request.current_data) : {};
        
        // Extract the fields that were modified
        for (const [key, value] of Object.entries(newData)) {
          if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
            edits[key] = {
              oldValue: currentData[key],
              newValue: value,
              timestamp: Date.now()
            };
          }
        }
      } catch (error) {
        console.error('Error parsing new_data/current_data:', error);
      }
    }
    
    // Fall back to changes field if needed
    if (Object.keys(edits).length === 0 && request.changes) {
      try {
        edits = JSON.parse(request.changes);
      } catch (error) {
        console.error('Error parsing changes:', error);
      }
    }
    
    // Final fallback - create a simple edit based on the description
    if (Object.keys(edits).length === 0 && request.description) {
      const lines = request.description.split('\n');
      for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
          const [_, field, value] = match;
          edits[field.trim().toLowerCase()] = {
            newValue: value.trim(),
            timestamp: Date.now()
          };
        }
      }
    }
    
    // Create an edit session with the edits from the request
    await saveEditSession(
      userId,
      request.marker_id,
      request.marker_name,
      edits
    );
    
    return await getEditSession(userId, request.marker_id);
  } catch (error) {
    console.error('Error creating session from request:', error);
    return null;
  }
}

/**
 * Undo a request implementation
 */
async function undoRequest(requestId) {
  console.log(`Undoing request: ${requestId}`);
  try {
    // Get the request
    const request = await getRequestById(requestId);
    
    if (!request) {
      console.error('Request not found');
      return { success: false, error: 'Request not found' };
    }
    
    if (request.status !== 'implemented') {
      console.error('Request has not been implemented');
      return { success: false, error: 'Request has not been implemented' };
    }
    
    // Get the original data
    let originalData;
    try {
      originalData = request.currentData ? JSON.parse(request.currentData) : null;
    } catch (error) {
      console.error('Error parsing original data:', error);
      return { success: false, error: 'Cannot parse original data' };
    }
    
    if (!originalData || !request.markerId) {
      console.error('Missing original data or marker ID');
      return { success: false, error: 'Missing data required for undo' };
    }
    
    // Revert the marker to its original state
    await prisma.Location.update({
      where: { id: request.markerId },
      data: originalData
    });
    
    // Update the request status
    await prisma.discordLocationRequest.update({
      where: { id: requestId },
      data: {
        status: 'reverted',
        updatedAt: new Date()
      }
    });
    
    // Notify web application of the change
    await notifyDatabaseChange();
    
    return { success: true };
  } catch (error) {
    console.error('Error undoing request:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Search for locations to use in autocomplete
 */
async function searchLocationsForAutocomplete(searchTerm) {
  console.log(`searchLocationsForAutocomplete called with term: ${searchTerm}`);
  try {
    // Check if the search term is a UUID (marker ID format)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm);
    
    let locations = [];
    
    if (isUuid) {
      // If it's a UUID format, do a direct ID query
      console.log('Detected UUID format, performing direct ID lookup');
      
      // Query by ID directly with raw SQL
      locations = await prisma.$queryRaw`
        SELECT id, name, type, description, coordinates, icon 
        FROM "Location" 
        WHERE id = ${searchTerm}`;
      
      console.log(`ID lookup result count: ${locations.length}`);
    } else {
      // Continue with the existing name-based search
      // Check if search includes the '#' character (index search)
      if (searchTerm.includes('#')) {
        const [namePrefix, indexStr] = searchTerm.split('#');
        const baseName = namePrefix.trim();
        
        // Get all locations matching the name prefix
        locations = await prisma.$queryRaw`
          SELECT id, name, type, coordinates 
          FROM "Location" 
          WHERE name ILIKE ${`%${baseName}%`} 
          ORDER BY 
            -- Prioritize exact matches first
            CASE WHEN name ILIKE ${baseName} THEN 0
                 WHEN name ILIKE ${`${baseName}%`} THEN 1
                 ELSE 2 
            END,
            name ASC 
          LIMIT 25`;
        
        if (!locations || locations.length === 0) {
          return [];
        }
        
        // Process the coordinates for each location
        const processedLocations = [];
        
        // Track if we found an exact match for index
        let exactMatchFound = false;
        
        for (let loc of locations) {
          try {
            const coords = loc.coordinates;
            
            // Skip if not a multi-coordinate location
            if (!Array.isArray(coords) || (coords.length === 2 && typeof coords[0] === 'number')) {
              processedLocations.push(loc);
              continue;
            }
            
            // Number of coordinate points
            const coordCount = coords.length;
            
            // If there's an index string, prioritize exact matches
            if (indexStr && indexStr.trim() !== '') {
              const indexNum = parseInt(indexStr.trim());
              
              // If specific index is requested and valid
              if (!isNaN(indexNum) && indexNum > 0 && indexNum <= coordCount) {
                const exactMatch = {
                  ...loc,
                  indexRequested: indexNum - 1, // Convert to 0-based for internal use
                  name: `${loc.name} #${indexNum}`, // Include index in name for display
                  isExactMatch: true
                };
                
                // If this is our first exact match and it belongs to the top location result,
                // put it at the very beginning to prioritize it
                if (!exactMatchFound && processedLocations.length === 0) {
                  processedLocations.unshift(exactMatch);
                  exactMatchFound = true;
                } else {
                  processedLocations.push(exactMatch);
                }
              }
            } else {
              // No specific index - add all indices for this location
              for (let i = 0; i < coordCount; i++) {
                processedLocations.push({
                  ...loc,
                  indexRequested: i,
                  name: `${loc.name} #${i+1}` // Include index in name for display
                });
              }
            }
          } catch (e) {
            console.error('Error processing coordinates for search:', e);
            processedLocations.push(loc); // Add the location as-is on error
          }
        }
        
        // Sort results to prioritize exact matches
        if (indexStr && indexStr.trim() !== '') {
          processedLocations.sort((a, b) => {
            // First prioritize locations with exact name match
            const aNameMatch = a.name.toLowerCase().startsWith(baseName.toLowerCase()) ? 0 : 1;
            const bNameMatch = b.name.toLowerCase().startsWith(baseName.toLowerCase()) ? 0 : 1;
            
            if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch;
            
            // Then prioritize locations with exact index match
            const aExactMatch = a.isExactMatch ? 0 : 1;
            const bExactMatch = b.isExactMatch ? 0 : 1;
            
            return aExactMatch - bExactMatch;
          });
        }
        
        console.log(`Found ${processedLocations.length} matches for "${searchTerm}"`);
        
        // Log the top result for debugging
        if (processedLocations.length > 0) {
          console.log(`Top match: ${processedLocations[0].name}`);
        }
        
        return processedLocations;
      }
      
      // Standard search without '#' character
      locations = await prisma.$queryRaw`
        SELECT id, name, type, coordinates 
        FROM "Location" 
        WHERE name ILIKE ${`%${searchTerm}%`} 
        ORDER BY 
          -- Prioritize exact matches first
          CASE WHEN name ILIKE ${searchTerm} THEN 0
               WHEN name ILIKE ${`${searchTerm}%`} THEN 1
               ELSE 2 
          END,
          name ASC 
        LIMIT 25`;
    }
    
    return locations || [];
  } catch (error) {
    console.error('Error searching locations for autocomplete:', error);
    return []; // Return empty array on error
  }
}

/**
 * Safe column checker that returns whether a column exists
 */
async function columnExists(tableName, columnName) {
  try {
    const result = await prisma.$queryRaw`
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = ${tableName} 
      AND column_name = ${columnName}`;
    
    return result.length > 0;
  } catch (error) {
    console.error(`Error checking if column ${columnName} exists in ${tableName}:`, error);
    return false;
  }
}

module.exports = {
  initializeDatabase,
  saveRequest,
  updateRequestStatus,
  getRequestsByStatus,
  getAllRequests,
  getContributorLeaderboard,
  getLeaderboardInfo,
  setLeaderboardInfo,
  deleteRequestByMessageId,
  searchLocationsForAutocomplete,
  saveEditSession,
  getEditSession,
  deleteEditSession,
  getRequestById,
  undoRequest,
  getRequestByMessageId,
  createSessionFromRequest,
  columnExists
};
