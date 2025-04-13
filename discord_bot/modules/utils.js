const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

/**
 * Get map version information from the mapversion.yml file
 */
function getMapVersionInfo() {
  try {
    const versionFilePath = path.join(__dirname, '..', 'src', 'mapversion.yml');
    if (fs.existsSync(versionFilePath)) {
      const versionData = yaml.load(fs.readFileSync(versionFilePath, 'utf8'));
      return {
        mapVersion: versionData.version || 'unknown',
        gameVersion: versionData.game_version || 'unknown'
      };
    } else {
      console.warn(`Map version file not found at ${versionFilePath}`);
      return { mapVersion: 'unknown', gameVersion: 'unknown' };
    }
  } catch (error) {
    console.error('Error reading map version file:', error);
    return { mapVersion: 'unknown', gameVersion: 'unknown' };
  }
}

/**
 * Format coordinates and extract individual coordinate data
 */
function formatCoordinates(coordsString) {
  // Remove all whitespace
  coordsString = coordsString.replace(/\s+/g, '');
  
  // Match all coordinate pairs [x,y]
  const coordPairs = coordsString.match(/\[-?\d+,-?\d+\]/g);
  
  if (!coordPairs) return { formatted: null, coordinates: [] };
  
  const coordinates = [];
  
  // Format each pair with proper spacing
  const formatted = coordPairs.map(pair => {
    // Extract x and y values
    const [x, y] = pair.slice(1, -1).split(',').map(num => parseInt(num.trim()));
    coordinates.push({ x, y });
    return `- [${x}, ${y}]`;
  }).join('\n');
  
  return { formatted, coordinates };
}

/**
 * Validate coordinate string format
 */
function validateCoordinates(coordsString) {
  // Match one or more coordinate pairs separated by commas: [x,y], [x,y]
  const coordRegex = /^(\[\s*-?\d+\s*,\s*-?\d+\s*\])(\s*,\s*\[\s*-?\d+\s*,\s*-?\d+\s*\])*$/;
  return coordRegex.test(coordsString);
}

/**
 * Generate clickable map links for coordinates
 */
function generateMapLinks(coordinates) {
  return coordinates.map(coord => {
    return `[View [${coord.x}, ${coord.y}] on map](https://soulmap.avakot.org/?coord=${coord.x},${coord.y})`;
  }).join('\n');
}

/**
 * Helper function to parse marker name and index from selection
 */
function parseMarkerSelection(selection) {
  // Check if this is a composite value with an index
  if (selection.includes('|')) {
    const [name, indexStr] = selection.split('|');
    const index = indexStr === '*' ? '*' : parseInt(indexStr, 10);
    return { name, index };
  }
  
  // Check if this uses "name #index" format
  const indexMatch = selection.match(/(.+)\s+#(\d+)$/);
  if (indexMatch) {
    const name = indexMatch[1].trim();
    const index = parseInt(indexMatch[2], 10);
    return { name, index };
  }
  
  // Regular marker without index specification
  return { name: selection, index: undefined };
}

/**
 * Helper function to truncate text
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Helper function to format stored coordinates to string
 */
function formatStoredCoordinatesToString(coordinates) {
  if (!Array.isArray(coordinates)) {
    return '';
  }
  
  if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
    return `[${coordinates[0]}, ${coordinates[1]}]`;
  }
  
  return coordinates.map(coord => `[${coord[0]}, ${coord[1]}]`).join('\n');
}

/**
 * Generate a diff visualization for edits
 */
function generateEditDiff(originalData, newData) {
  let diff = '```diff\n';
  
  // Compare name
  if (originalData.name !== newData.name) {
    diff += `- Name: ${originalData.name}\n+ Name: ${newData.name}\n\n`;
  }
  
  // Compare type
  if (originalData.type !== newData.type) {
    diff += `- Type: ${originalData.type}\n+ Type: ${newData.type}\n\n`;
  }
  
  // Compare description (truncate if too long)
  if (originalData.description !== newData.description) {
    const oldDesc = truncateText(originalData.description, 100);
    const newDesc = truncateText(newData.description, 100);
    diff += `- Description: ${oldDesc}\n+ Description: ${newDesc}\n\n`;
  }
  
  // Compare icon
  if (originalData.icon !== newData.icon) {
    diff += `- Icon: ${originalData.icon || 'none'}\n+ Icon: ${newData.icon || 'none'}\n\n`;
  }
  
  // Compare coordinates
  const oldCoords = formatStoredCoordinatesToString(originalData.coordinates).replace(/\n/g, ', ');
  const newCoords = formatStoredCoordinatesToString(newData.coordinates).replace(/\n/g, ', ');
  
  if (oldCoords !== newCoords) {
    diff += `- Coordinates: ${oldCoords}\n+ Coordinates: ${newCoords}\n\n`;
  }
  
  diff += '```';
  
  // If no changes, show a message
  if (diff === '```diff\n```') {
    return 'No changes detected.';
  }
  
  return diff;
}

/**
 * Generate a diff display between old and new values
 */
function generateEditDiff(oldValue, newValue) {
  // Convert values to strings for display
  const oldStr = typeof oldValue === 'object' ? JSON.stringify(oldValue, null, 2) : String(oldValue || '');
  const newStr = typeof newValue === 'object' ? JSON.stringify(newValue, null, 2) : String(newValue || '');
  
  // Create a diff display
  return "```diff\n" +
         "- " + oldStr.replace(/\n/g, '\n- ') + "\n" +
         "+ " + newStr.replace(/\n/g, '\n+ ') + "\n" +
         "```";
}

module.exports = {
  getMapVersionInfo,
  formatCoordinates,
  validateCoordinates,
  generateMapLinks,
  parseMarkerSelection,
  truncateText,
  formatStoredCoordinatesToString,
  generateEditDiff
};
