/**
 * Class to manage edit sessions for location marker edits
 */
class EditSessionManager {
  constructor(dbFunctions) {
    this.sessionCache = new Map();
    this.dbFunctions = dbFunctions;
    this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    
    // Start periodic cleanup
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000); // Run every 5 minutes
  }
  
  /**
   * Get an edit session from memory cache
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID
   * @returns {Object} Session object with edits property
   */
  async getSession(userId, markerId) {
    console.log(`Getting edit session for user ${userId}, marker ${markerId}`);
    try {
      const cacheKey = `${userId}_${markerId}`;
      const session = this.sessionCache.get(cacheKey);
      
      if (session) {
        // Update last accessed time
        session.lastAccessed = Date.now();
        this.sessionCache.set(cacheKey, session);
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
   * Save edit session to memory cache
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID
   * @param {string} markerName - Location marker name
   * @param {Object} edits - Edits object with field changes
   * @returns {boolean} Success state
   */
  async saveSession(userId, markerId, markerName, edits) {
    console.log(`Saving edit session for user ${userId}, marker ${markerId}`);
    try {
      const cacheKey = `${userId}_${markerId}`;
      const session = {
        userId,
        markerId,
        markerName,
        edits,
        created: this.sessionCache.get(cacheKey)?.created || Date.now(),
        lastAccessed: Date.now()
      };
      
      this.sessionCache.set(cacheKey, session);
      console.log('Edit session saved to cache');
      return true;
    } catch (error) {
      console.error('Error saving edit session to cache:', error);
      return false;
    }
  }
  
  /**
   * Delete an edit session from memory cache
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID
   * @returns {boolean} Success state
   */
  async deleteSession(userId, markerId) {
    console.log(`Deleting edit session for user ${userId}, marker ${markerId}`);
    try {
      const cacheKey = `${userId}_${markerId}`;
      const deleted = this.sessionCache.delete(cacheKey);
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
  cleanupExpiredSessions() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [key, session] of this.sessionCache.entries()) {
      if (now - session.lastAccessed > this.SESSION_TIMEOUT) {
        this.sessionCache.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      console.log(`Cleaned up ${expiredCount} expired edit sessions`);
    }
  }
  
  /**
   * Create a new session for a marker by its UUID
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID
   * @returns {Promise<Object>} Session object with marker data
   */
  async createSessionForMarker(userId, markerId) {
    console.log(`Creating new edit session for user ${userId}, marker ${markerId}`);
    try {
      // Get marker data
      const locations = await this.dbFunctions.searchLocationsForAutocomplete(markerId);
      const marker = locations.find(loc => loc.id === markerId);
      
      if (!marker) {
        console.error(`Marker ${markerId} not found in database`);
        return null;
      }
      
      // Create empty session
      await this.saveSession(userId, markerId, marker.name, {});
      
      // Return marker data with session
      return {
        marker,
        session: await this.getSession(userId, markerId)
      };
    } catch (error) {
      console.error('Error creating session for marker:', error);
      return null;
    }
  }
  
  /**
   * Add a field edit to an existing session
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID
   * @param {string} field - Field name to edit
   * @param {*} newValue - New value for the field
   * @param {*} oldValue - Old value for the field (optional)
   * @returns {Promise<Object>} Updated session object
   */
  async addFieldEdit(userId, markerId, field, newValue, oldValue = undefined) {
    try {
      // Get current session
      let session = await this.getSession(userId, markerId);
      
      if (!session.edits) {
        session.edits = {};
      }
      
      // If oldValue not provided, try to get it from the marker
      if (oldValue === undefined) {
        const locations = await this.dbFunctions.searchLocationsForAutocomplete(markerId);
        const marker = locations.find(loc => loc.id === markerId);
        
        if (marker && marker[field] !== undefined) {
          oldValue = marker[field];
        }
      }
      
      // Add edit to session
      session.edits[field] = {
        oldValue,
        newValue,
        timestamp: Date.now()
      };
      
      // Save updated session
      await this.saveSession(userId, markerId, session.markerName, session.edits);
      
      // Return updated session
      return await this.getSession(userId, markerId);
    } catch (error) {
      console.error('Error adding field edit to session:', error);
      return null;
    }
  }
  
  /**
   * Convert an edit session to a database request
   * @param {string} messageId - Discord message ID
   * @param {string} userId - Discord user ID
   * @param {string} markerId - Location marker UUID 
   * @param {string} reason - Reason for the edit
   * @returns {Promise<boolean>} Success state
   */
  async saveSessionAsRequest(messageId, userId, markerId, reason) {
    console.log(`Converting edit session to request: userId=${userId}, markerId=${markerId}`);
    try {
      // Get the edit session
      const session = await this.getSession(userId, markerId);
      
      if (!session || !session.edits || Object.keys(session.edits).length === 0) {
        console.error('No edit session found to convert');
        return false;
      }
      
      // Fetch current marker data from the database
      const locations = await this.dbFunctions.searchLocationsForAutocomplete(markerId);
      const marker = locations.find(loc => loc.id === markerId);
      
      if (!marker) {
        console.error('Marker not found in database');
        return false;
      }
      
      // Prepare the edits into a new data object
      const currentData = { ...marker };
      const newData = { ...marker };
      
      // Apply each edit to the newData
      for (const [field, data] of Object.entries(session.edits)) {
        if (data.newValue !== undefined) {
          newData[field] = data.newValue;
        }
      }
      
      // Make sure marker ID and name are explicitly included in the JSON
      currentData.id = markerId;
      newData.id = markerId;
      
      // Save the request with current and new data
      const result = await this.dbFunctions.saveRequest(messageId, userId, 'edit', reason, {
        currentData,
        newData
      });
      
      if (result) {
        // Delete the edit session after successful conversion
        await this.deleteSession(userId, markerId);
      }
      
      return result;
    } catch (error) {
      console.error('Error converting edit session to request:', error);
      return false;
    }
  }
  
  /**
   * Create a new edit session based on an existing request
   * @param {string} userId - Discord user ID
   * @param {string} messageId - Discord message ID
   * @param {boolean} isAdmin - Whether user is an admin
   * @returns {Promise<Object>} Created session
   */
  async createSessionFromRequest(userId, messageId, isAdmin = false) {
    console.log(`Creating edit session for user ${userId} from request ${messageId}`);
    try {
      const request = await this.dbFunctions.getRequestByMessageId(messageId);
      
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
      await this.saveSession(
        userId,
        request.marker_id,
        request.marker_name,
        edits
      );
      
      return await this.getSession(userId, request.marker_id);
    } catch (error) {
      console.error('Error creating session from request:', error);
      return null;
    }
  }
}

module.exports = EditSessionManager;
