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
 * Compare two objects and return a string of changes
 * @param {Object} oldData - Original data
 * @param {Object} newData - Updated data
 * @returns {string} - Formatted change string
 */
function getChanges(oldData, newData) {
  if (!oldData || !newData) return 'Complete data change';
  
  const changes = [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  
  for (const key of allKeys) {
    // Skip internal fields or fields we don't want to track
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt' || key === 'lastModified') continue;
    
    const oldValue = oldData[key];
    const newValue = newData[key];
    
    // Skip if both values are empty/null
    if ((oldValue === undefined || oldValue === null || oldValue === '') && 
        (newValue === undefined || newValue === null || newValue === '')) {
      continue;
    }
    
    // Check if the value changed
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      // Format the change based on field type
      let formattedChange = '';
      
      switch (key) {
        case 'coordinates':
          const oldCoords = formatCoordinates(oldValue);
          const newCoords = formatCoordinates(newValue);
          formattedChange = `**${key}**: ${oldCoords} → ${newCoords}`;
          break;
          
        case 'description':
        case 'lore':
        case 'spoilers':
          // For text fields, show a length comparison if content is long
          if ((oldValue && oldValue.length > 50) || (newValue && newValue.length > 50)) {
            const oldLength = oldValue ? oldValue.length : 0;
            const newLength = newValue ? newValue.length : 0;
            formattedChange = `**${key}**: Text changed (${oldLength} → ${newLength} chars)`;
          } else {
            // For shorter text, show the actual change
            const oldText = oldValue || '(empty)';
            const newText = newValue || '(empty)';
            formattedChange = `**${key}**: "${oldText}" → "${newText}"`;
          }
          break;
          
        case 'mediaUrl':
          // For media URLs, show count changes
          const oldCount = Array.isArray(oldValue) ? oldValue.length : 0;
          const newCount = Array.isArray(newValue) ? newValue.length : 0;
          formattedChange = `**${key}**: ${oldCount} URLs → ${newCount} URLs`;
          break;
          
        case 'iconSize':
        case 'radius':
          // For numeric fields, show the value change
          formattedChange = `**${key}**: ${oldValue || 0} → ${newValue || 0}`;
          break;
          
        case 'iconColor':
          // For color fields, make them more visible
          formattedChange = `**${key}**: ${oldValue || '#FFFFFF'} → ${newValue || '#FFFFFF'}`;
          break;
          
        default:
          // For all other fields, show simple before/after
          formattedChange = `**${key}**: ${oldValue || '(empty)'} → ${newValue || '(empty)'}`;
      }
      
      changes.push(formattedChange);
    }
  }
  
  return changes.length ? changes.join('\n') : 'No detectable changes';
}

/**
 * Send a log to Discord webhook
 * 
 * @param {Object} options - Log options
 * @param {string} options.action - The action performed (create, update, delete)
 * @param {Object} options.user - The user who performed the action
 * @param {Object} options.data - The affected data
 * @param {Object} [options.oldData] - The previous data (for update actions)
 * @param {string} [options.color] - Hex color for the Discord embed (without #)
 */
export async function sendLogToDiscord({ action, user, data, oldData, color }) {
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
  
  // Format data based on action type
  let locationInfo = '';
  let changesInfo = '';
  
  if (data) {
    // Basic identification always included
    locationInfo = `**ID**: ${data.id}\n**Name**: ${data.name}\n**Type**: ${data.type || 'Unknown'}`;
    
    if (action.toLowerCase() === 'update' && oldData) {
      // For updates, show what changed
      changesInfo = getChanges(oldData, data);
    } else if (action.toLowerCase() === 'create') {
      // For creation, show basic details
      locationInfo += `\n**Coordinates**: ${formatCoordinates(data.coordinates)}`;
      if (data.description) {
        const truncatedDesc = data.description.length > 100 ? 
          `${data.description.substring(0, 97)}...` : 
          data.description;
        locationInfo += `\n**Description**: ${truncatedDesc}`;
      }
    }
    // For deletion, just show the basic info
  }
  
  // Ensure we don't exceed character limits
  if (locationInfo.length > CHARACTER_LIMIT - 50) {
    locationInfo = locationInfo.substring(0, CHARACTER_LIMIT - 53) + '...';
  }
  
  if (changesInfo && changesInfo.length > CHARACTER_LIMIT) {
    changesInfo = changesInfo.substring(0, CHARACTER_LIMIT - 3) + '...';
  }
  
  // Create embed fields
  const fields = [
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
  ];
  
  // Add changes field if we have changes
  if (changesInfo && action.toLowerCase() === 'update') {
    fields.push({
      name: 'Changes',
      value: changesInfo
    });
  }
  
  // Create embed
  const embed = {
    title: `Location ${action.charAt(0).toUpperCase() + action.slice(1)}`,
    color: parseInt(color, 16),
    fields: fields,
    footer: {
      text: `Soulmap Admin - ${new Date().toLocaleString()}`
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
