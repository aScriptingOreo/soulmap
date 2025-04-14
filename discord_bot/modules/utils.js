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
 * Validate and parse coordinates from string
 * @param {string} coordString - String with coordinates in [X, Y] format, can have multiple coords
 * @returns {Array} Parsed coordinates or null if invalid
 */
function validateAndParseCoordinates(coordString) {
  try {
    // Remove any whitespace
    const trimmed = coordString.trim();
    
    // Check if it might be multiple coordinates
    if (trimmed.includes('\n') || trimmed.includes('],[')) {
      // Split by newline or comma+bracket pattern
      const coordStrings = trimmed
        .replace(/\]\s*,\s*\[/g, ']\n[') // Normalize separators
        .split('\n')
        .filter(line => line.trim().length > 0);
      
      // Parse each coordinate pair
      const coords = [];
      for (const coordStr of coordStrings) {
        const match = coordStr.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
        if (!match) {
          console.warn(`Invalid coordinate format: ${coordStr}`);
          continue;
        }
        coords.push([parseFloat(match[1]), parseFloat(match[2])]);
      }
      
      return coords.length > 0 ? coords : null;
    } else {
      // Single coordinate pair
      const match = trimmed.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
      if (!match) {
        return null;
      }
      return [parseFloat(match[1]), parseFloat(match[2])];
    }
  } catch (error) {
    console.error('Error parsing coordinates:', error);
    return null;
  }
}

/**
 * Parse coordinates from string and return formatted version
 * @param {string} coordString - String containing coordinates
 * @returns {object} Formatted coordinates and extracted data
 */
function formatCoordinates(coordString) {
  try {
    // Parse the coordinates
    const parsedCoords = validateAndParseCoordinates(coordString);
    
    if (!parsedCoords) {
      return { formatted: null, coordinates: null };
    }
    
    // Format for display
    let formatted;
    let coordinates;
    
    if (Array.isArray(parsedCoords[0])) {
      // Multiple coordinates
      formatted = parsedCoords.map(coord => `[${coord[0]}, ${coord[1]}]`).join('\n');
      coordinates = parsedCoords; // For multi-coordinates, preserve the array structure
    } else {
      // Single coordinate pair
      formatted = `[${parsedCoords[0]}, ${parsedCoords[1]}]`;
      coordinates = parsedCoords; // For single coordinates, keep as [x, y]
    }
    
    return { formatted, coordinates };
  } catch (error) {
    console.error('Error formatting coordinates:', error);
    return { formatted: null, coordinates: null };
  }
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
 * Generate map links from coordinates
 * @param {Array} coordinates - Coordinate data
 * @returns {string} Formatted map links
 */
function generateMapLinks(coordinates) {
  try {
    let links = [];
    
    // Handle different coordinate formats
    if (Array.isArray(coordinates)) {
      if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
        // Single coordinate pair
        const [x, y] = coordinates;
        links.push(`[View on map](https://soulmap.avakot.org/?coord=${x},${y})`);
      } else if (coordinates.length > 0) {
        // Multiple coordinates - get first 5 to avoid cluttering
        const maxCoords = Math.min(coordinates.length, 5);
        for (let i = 0; i < maxCoords; i++) {
          if (Array.isArray(coordinates[i]) && coordinates[i].length === 2) {
            const [x, y] = coordinates[i];
            links.push(`[Point #${i+1}](https://soulmap.avakot.org/?coord=${x},${y})`);
          }
        }
        
        if (coordinates.length > 5) {
          links.push(`*...and ${coordinates.length - 5} more points*`);
        }
      }
    }
    
    return links.join('\n') || 'No valid coordinates found';
  } catch (error) {
    console.error('Error generating map links:', error);
    return 'Error generating map links';
  }
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

/**
 * Find best matching marker names using Google's Gemini API
 * @param {string} query - User query to match
 * @param {string[]} markerNames - Array of available marker names
 * @param {number} limit - Maximum number of matches to return
 * @returns {Promise<string[]>} Array of best matching marker names
 */
async function findBestMarkerNameMatch(query, markerNames, limit = 1) {
  if (!query || !markerNames || markerNames.length === 0) {
    return [];
  }

  try {
    // Get the API key from environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set in environment variables');
      return [];
    }

    // Prepare a compact representation of marker names (limit to avoid token overuse)
    const markerNamesString = markerNames.slice(0, 500).join(', ');

    // Craft the prompt for Gemini
    const prompt = `
You are a marker name matching assistant. From the list of available marker names below, find the ${limit} best matches for the user's query.
Return ONLY the exact marker names as a numbered list without any explanation or additional text.
If there are no good matches, return "NO_MATCHES_FOUND".

User query: "${query}"

Available marker names: ${markerNamesString}
`;

    // Call the Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        }),
        timeout: 5000 // 5 second timeout to avoid hanging
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Extract the text from the response
    if (result.candidates && 
        result.candidates[0] && 
        result.candidates[0].content && 
        result.candidates[0].content.parts && 
        result.candidates[0].content.parts[0] && 
        result.candidates[0].content.parts[0].text) {
      
      const responseText = result.candidates[0].content.parts[0].text.trim();
      
      // Handle no matches case
      if (responseText === "NO_MATCHES_FOUND") {
        return [];
      }
      
      // Parse the numbered list (e.g., "1. Name1\n2. Name2")
      const matches = responseText
        .split('\n')
        .map(line => line.replace(/^\d+\.\s*/, '').trim()) // Remove numbers and trim
        .filter(name => name && markerNames.includes(name)); // Validate against original names
      
      return matches.slice(0, limit);
    }
    
    return [];
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return [];
  }
}

/**
 * Enhanced marker name search that combines direct matching with AI matching
 * @param {string} query - User query to match
 * @param {string[]} markerNames - Array of available marker names
 * @param {number} limit - Maximum number of matches to return
 * @returns {Promise<string[]>} Array of best matching marker names
 */
async function enhancedMarkerNameSearch(query, markerNames, limit = 5) {
  // First, try direct matching for exact or partial matches
  const directMatches = markerNames
    .filter(name => name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      // Prioritize exact matches and starts-with matches
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const queryLower = query.toLowerCase();
      
      // Exact match gets highest priority
      if (aLower === queryLower && bLower !== queryLower) return -1;
      if (aLower !== queryLower && bLower === queryLower) return 1;
      
      // Starts with gets next priority
      if (aLower.startsWith(queryLower) && !bLower.startsWith(queryLower)) return -1;
      if (!aLower.startsWith(queryLower) && bLower.startsWith(queryLower)) return 1;
      
      // Default to alphabetical sorting
      return a.localeCompare(b);
    })
    .slice(0, limit);
  
  // If we have enough direct matches, return them immediately
  if (directMatches.length >= limit) {
    return directMatches;
  }
  
  // Otherwise, try the AI matching to supplement
  try {
    const aiMatches = await findBestMarkerNameMatch(
      query, 
      markerNames.filter(name => !directMatches.includes(name)), // Only check names not already matched
      limit - directMatches.length
    );
    
    // Combine direct matches with AI matches
    return [...directMatches, ...aiMatches];
  } catch (error) {
    console.error('Error in enhanced marker search:', error);
    // Fall back to direct matches only if AI fails
    return directMatches;
  }
}

// Cache for marker names with TTL
let markerNamesCache = {
  names: [],
  lastUpdated: 0,
  ttl: 60 * 60 * 1000 // 1 hour cache TTL
};

/**
 * Fetch all marker names from the database
 * @param {object} prisma - Prisma client instance
 * @param {boolean} forceRefresh - Force refresh cache even if not expired
 * @returns {Promise<string[]>} Array of marker names
 */
async function getAllMarkerNames(prisma, forceRefresh = false) {
  const now = Date.now();
  
  // Return cached names if they're still valid
  if (!forceRefresh && 
      markerNamesCache.names.length > 0 && 
      (now - markerNamesCache.lastUpdated < markerNamesCache.ttl)) {
    console.log(`Using cached marker names (${markerNamesCache.names.length} names)`);
    return markerNamesCache.names;
  }
  
  console.log('Fetching all marker names from database...');
  try {
    // Fetch only the names to keep the query light
    const results = await prisma.$queryRaw`
      SELECT name FROM "Location" 
      ORDER BY name ASC`;
    
    // Extract name strings from results
    const names = results.map(row => row.name);
    
    // Update cache
    markerNamesCache = {
      names,
      lastUpdated: now,
      ttl: markerNamesCache.ttl
    };
    
    console.log(`Fetched ${names.length} marker names from database`);
    return names;
  } catch (error) {
    console.error('Error fetching marker names:', error);
    // Return cached names even if expired in case of error
    return markerNamesCache.names;
  }
}

/**
 * Find best matching marker names using Google's Gemini API with full database context
 * @param {string} query - User query to match
 * @param {object} prisma - Prisma client instance
 * @param {number} limit - Maximum number of matches to return
 * @returns {Promise<string[]>} Array of best matching marker names
 */
async function findBestMarkerNameMatchWithContext(query, prisma, limit = 1) {
  if (!query || !prisma) {
    return [];
  }

  try {
    // Get all marker names to provide full context
    const allMarkerNames = await getAllMarkerNames(prisma);
    
    if (allMarkerNames.length === 0) {
      console.warn('No marker names available in database');
      return [];
    }
    
    // Get the API key from environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set in environment variables');
      return [];
    }

    // Prepare a more representative sample of marker names
    // Take some from the beginning, middle, and end to provide a good distribution
    const maxSampleSize = 500; // Limit to avoid token overuse
    let sampleNames = [];
    
    if (allMarkerNames.length <= maxSampleSize) {
      sampleNames = allMarkerNames;
    } else {
      // Take samples from beginning, middle and end
      const third = Math.floor(maxSampleSize / 3);
      const startSample = allMarkerNames.slice(0, third);
      const middleIndex = Math.floor(allMarkerNames.length / 2) - Math.floor(third / 2);
      const middleSample = allMarkerNames.slice(middleIndex, middleIndex + third);
      const endSample = allMarkerNames.slice(-third);
      sampleNames = [...startSample, ...middleSample, ...endSample];
    }
    
    const markerNamesString = sampleNames.join(', ');

    // Craft the prompt for Gemini
    const prompt = `
From the list of available marker names below, find the ${limit} best match for the user's query.
Return ONLY the exact names as a numbered list without any explanation or additional text.
If there are no good matches, return "NO_MATCHES_FOUND".

This is a sample of ${sampleNames.length} names from our complete database of ${allMarkerNames.length} marker names.

User query: "${query}"

Available marker names: ${markerNamesString}
`;

    // Call the Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        }),
        timeout: 5000 // 5 second timeout to avoid hanging
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Extract the text from the response
    if (result.candidates && 
        result.candidates[0] && 
        result.candidates[0].content && 
        result.candidates[0].content.parts && 
        result.candidates[0].content.parts[0] && 
        result.candidates[0].content.parts[0].text) {
      
      const responseText = result.candidates[0].content.parts[0].text.trim();
      
      // Handle no matches case
      if (responseText === "NO_MATCHES_FOUND") {
        return [];
      }
      
      // Parse the numbered list (e.g., "1. Name1\n2. Name2")
      const matches = responseText
        .split('\n')
        .map(line => line.replace(/^\d+\.\s*/, '').trim()) // Remove numbers and trim
        .filter(name => name && allMarkerNames.includes(name)); // Validate against ALL original names
      
      return matches.slice(0, limit);
    }
    
    return [];
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return [];
  }
}

/**
 * Enhanced marker name search that combines direct matching with AI matching using full database context
 * @param {string} query - User query to match
 * @param {object} prisma - Prisma client instance
 * @param {number} limit - Maximum number of matches to return
 * @returns {Promise<string[]>} Array of best matching marker names
 */
async function enhancedMarkerNameSearchWithContext(query, prisma, limit = 5) {
  // Get all marker names to use for direct matching
  const allMarkerNames = await getAllMarkerNames(prisma);
  
  // First, try direct matching for exact or partial matches
  const directMatches = allMarkerNames
    .filter(name => name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      // Prioritize exact matches and starts-with matches
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const queryLower = query.toLowerCase();
      
      // Exact match gets highest priority
      if (aLower === queryLower && bLower !== queryLower) return -1;
      if (aLower !== queryLower && bLower === queryLower) return 1;
      
      // Starts with gets next priority
      if (aLower.startsWith(queryLower) && !bLower.startsWith(queryLower)) return -1;
      if (!aLower.startsWith(queryLower) && bLower.startsWith(queryLower)) return 1;
      
      // Default to alphabetical sorting
      return a.localeCompare(b);
    })
    .slice(0, limit);
  
  // If we have enough direct matches, return them immediately
  if (directMatches.length >= limit) {
    return directMatches;
  }
  
  // Otherwise, try the AI matching to supplement
  try {
    const aiMatches = await findBestMarkerNameMatchWithContext(
      query, 
      prisma,
      limit - directMatches.length
    );
    
    // Filter out any AI matches that are already in directMatches
    const uniqueAiMatches = aiMatches.filter(name => !directMatches.includes(name));
    
    // Combine direct matches with AI matches
    return [...directMatches, ...uniqueAiMatches];
  } catch (error) {
    console.error('Error in enhanced marker search:', error);
    // Fall back to direct matches only if AI fails
    return directMatches;
  }
}

/**
 * Predict the best type for a marker based on its name and description
 * @param {string} name - Marker name
 * @param {string} description - User-provided description of the marker
 * @returns {Promise<string>} Predicted type
 */
async function predictMarkerCategory(name, description) {
  if (!name || !description) {
    return 'user_submitted'; // Default fallback type
  }

  try {
    // Get the API key from environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set in environment variables');
      return 'user_submitted';
    }

    // Define all available types
    const availableTypes = [
      'location', 'poi', 'quest', 'camp', 'dungeon', 'resource', 'user_submitted'
    ];
    
    // Craft the prompt for Gemini
    const prompt = `
You are a game map categorization assistant. Based on the name and description of a location marker, determine the most appropriate type.
Choose ONE type from this list: ${availableTypes.join(', ')}

Guidelines for types:
- location: Major settlements, towns, or important named areas
- poi: Points of interest, landmarks, special objects, or minor locations
- quest: Quest locations, NPCs, or quest-related objectives
- camp: Camps, resting areas, or outposts
- dungeon: Dungeons, caves, ruins, or challenging areas with enemies
- resource: Gathering spots, harvestable items, or crafting materials
- user_submitted: Default type when unclear (only use if absolutely necessary)

Marker name: "${name}"
User description: "${description}"

Return ONLY the type name without any additional text, explanation, or punctuation.
`;

    // Call the Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        }),
        timeout: 3000 // 3 second timeout to avoid hanging
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Extract the text from the response
    if (result.candidates && 
        result.candidates[0] && 
        result.candidates[0].content && 
        result.candidates[0].content.parts && 
        result.candidates[0].content.parts[0] && 
        result.candidates[0].content.parts[0].text) {
      
      const predictedType = result.candidates[0].content.parts[0].text.trim().toLowerCase();
      
      // Validate that the predicted type is in our allowed list
      if (availableTypes.includes(predictedType)) {
        console.log(`AI predicted type "${predictedType}" for "${name}"`);
        return predictedType;
      } else {
        console.log(`AI returned invalid type "${predictedType}", defaulting to user_submitted`);
        return 'user_submitted';
      }
    }
    
    return 'user_submitted'; // Default fallback
  } catch (error) {
    console.error('Error predicting marker type:', error);
    return 'user_submitted'; // Default on error
  }
}

module.exports = {
  getMapVersionInfo,
  formatCoordinates,
  validateCoordinates,
  generateMapLinks,
  parseMarkerSelection,
  truncateText,
  formatStoredCoordinatesToString,
  generateEditDiff,
  findBestMarkerNameMatch,
  enhancedMarkerNameSearch,
  getAllMarkerNames,
  findBestMarkerNameMatchWithContext,
  enhancedMarkerNameSearchWithContext,
  validateAndParseCoordinates,
  predictMarkerCategory
};
