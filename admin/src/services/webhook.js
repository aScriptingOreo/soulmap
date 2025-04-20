/**
 * Discord webhook service for logging admin actions
 */

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1363590769708892382/ydWe7U4-5WQ1q0QEw92UQe9jf6WIsUWtgrp7DcIP3odPxXoL9kmhHrYvzeKn6fPIwLcX';
const CHARACTER_LIMIT = 1024;

/**
 * Format coordinates for readable display in logs
 */
function formatCoordinates(coordinates) {
  if (!coordinates) return 'None';
  
  try {
    // If it's already a string, return it
    if (typeof coordinates === 'string') return coordinates;
    
    // Handle single coordinate pair [x,y]
    if (Array.isArray(coordinates) && coordinates.length === 2 && 
        typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      return `[${coordinates[0]}, ${coordinates[1]}]`;
    }
    
    // Handle multiple coordinate pairs [[x,y], [x,y], ...]
    if (Array.isArray(coordinates) && Array.isArray(coordinates[0])) {
      if (coordinates.length <= 3) {
        return JSON.stringify(coordinates);
      } else {
        // For many coordinates, show first 2 and indicate more
        return `${JSON.stringify(coordinates.slice(0, 2))} + ${coordinates.length - 2} more`;
      }
    }
    
    // Fallback to JSON string with length limit
    const jsonStr = JSON.stringify(coordinates);
    if (jsonStr.length > 100) {
      return jsonStr.substring(0, 97) + '...';
    }
    return jsonStr;
  } catch (e) {
    return 'Invalid coordinates';
  }
}

/**
 * Send a log to Discord webhook
 * 
 * @param {Object} options - Log options
 * @param {string} options.action - The action performed (create, update, delete)
 * @param {Object} options.user - The user who performed the action
 * @param {Object} options.data - The affected data
 * @param {string} [options.color] - Hex color for the Discord embed (without #)
 */
export async function sendLogToDiscord({ action, user, data, color }) {
  // Determine color based on action
  if (!color) {
    switch (action.toLowerCase()) {
      case 'create':
        color = '57F287'; // Green
        break;
      case 'update':
        color = 'FEE75C'; // Yellow
        break;
      case 'delete':
        color = 'ED4245'; // Red
        break;
      default:
        color = '5865F2'; // Discord blue
    }
  }
  
  // Format user information
  const userInfo = user ? `${user.username}${user.discriminator ? '#' + user.discriminator : ''} (${user.id})` : 'Unknown user';
  
  // Format data based on type
  let locationInfo = '';
  
  if (data) {
    if (action.toLowerCase() === 'delete') {
      locationInfo = `ID: ${data.id}\nName: ${data.name}\nType: ${data.type || 'Unknown'}`;
    } else {
      // For create/update, show more details
      locationInfo = `ID: ${data.id}\nName: ${data.name}\nType: ${data.type || 'Unknown'}\nCoordinates: ${formatCoordinates(data.coordinates)}`;
      
      if (data.description) {
        const truncatedDesc = data.description.length > 100 ? 
          `${data.description.substring(0, 97)}...` : 
          data.description;
        locationInfo += `\nDescription: ${truncatedDesc}`;
      }
    }
  }
  
  // Ensure we don't exceed character limit
  if (locationInfo.length > CHARACTER_LIMIT - 50) {
    locationInfo = locationInfo.substring(0, CHARACTER_LIMIT - 53) + '...';
  }
  
  // Create embed
  const embed = {
    title: `Location ${action.charAt(0).toUpperCase() + action.slice(1)}`,
    color: parseInt(color, 16),
    fields: [
      {
        name: 'User',
        value: userInfo,
        inline: true
      },
      {
        name: 'Action',
        value: action.charAt(0).toUpperCase() + action.slice(1),
        inline: true
      },
      {
        name: 'Timestamp',
        value: new Date().toISOString(),
        inline: true
      },
      {
        name: 'Location Details',
        value: locationInfo || 'No details available'
      }
    ],
    footer: {
      text: `SoulMap Admin - ${new Date().toLocaleString()}`
    }
  };
  
  // Send to webhook
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });
    
    if (!response.ok) {
      console.error('Failed to send webhook:', await response.text());
    }
    
    return response.ok;
  } catch (error) {
    console.error('Webhook error:', error);
    return false;
  }
}

export default {
  sendLogToDiscord
};
