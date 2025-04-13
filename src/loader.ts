// src/loader.ts
import type { Location, VersionInfo, CoordinateProperties } from './types';
import localforage from 'localforage';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';

const LOCATIONS_CACHE_KEY = 'soulmap_locations_cache';
const METADATA_CACHE_KEY = 'soulmap_metadata_cache';

// Use the environment variable provided by Vite for the API base URL
// Fallback to relative /api if the variable is not set (e.g., during build or local dev without env)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'; 
console.log(`Using API Base URL: ${API_BASE_URL}`); // Add log for debugging

// Initialize localforage instance for locations
const locationStore = localforage.createInstance({
  name: 'soulmap-locations',
  description: 'Cache for location data',
  driver: [
    localforage.INDEXEDDB,
    localforage.WEBSQL,
    localforage.LOCALSTORAGE
  ],
  storeName: 'locations' // Add explicit store name
});

// Track if a refresh is currently in progress to prevent multiple simultaneous refreshes
let refreshInProgress = false;

// Setup the refresh function that can be called when database changes occur
export async function setupDatabaseChangeListener(refreshCallback: () => Promise<void>) {
  try {
    // Use EventSource for Server-Sent Events - use the configured API_BASE_URL
    const eventSource = new EventSource(`${API_BASE_URL}/listen`);
    
    // Track last data refresh time to prevent over-refreshing
    let lastRefreshTime = Date.now();
    const MIN_REFRESH_INTERVAL = 10000; // 10 seconds minimum between refreshes
    
    eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'change' && !refreshInProgress) {
          // Only refresh if it's been at least MIN_REFRESH_INTERVAL since the last refresh
          const timeSinceLastRefresh = Date.now() - lastRefreshTime;
          if (timeSinceLastRefresh < MIN_REFRESH_INTERVAL) {
            console.log(`Database change detected, but last refresh was ${timeSinceLastRefresh}ms ago. Waiting...`);
            return;
          }
          
          console.log('Database change detected, refreshing locations...');
          refreshInProgress = true;
          
          try {
            // Show notification about the update
            showDatabaseUpdateNotification();
            
            lastRefreshTime = Date.now();
            await refreshCallback();
          } catch (error) {
            console.error('Error refreshing locations after database change:', error);
          } finally {
            refreshInProgress = false;
          }
        } else if (data.type === 'ping' && !refreshInProgress) {
          // For ping events, periodically check for changes (less frequently)
          const timeSinceLastRefresh = Date.now() - lastRefreshTime;
          
          if (timeSinceLastRefresh > 60000) { // 1 minute minimum between hash checks
            console.log('Checking for database changes via ping...');
            
            try {
              // Fetch database hash to see if anything changed
              const newHash = await generateDatabaseHash();
              const cachedData = await locationStore.getItem<{ hash: string }>(LOCATIONS_CACHE_KEY);
              
              if (cachedData && cachedData.hash !== newHash) {
                console.log('Database change detected via hash check, refreshing locations...');
                
                // Show notification about the update
                showDatabaseUpdateNotification();
                
                refreshInProgress = true;
                try {
                  lastRefreshTime = Date.now();
                  await refreshCallback();
                } finally {
                  refreshInProgress = false;
                }
              }
            } catch (error) {
              console.error('Error checking for database changes:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      // Reconnect after a delay
      setTimeout(() => {
        eventSource.close();
        setupDatabaseChangeListener(refreshCallback);
      }, 5000);
    };
    
    console.log('Database change listener initialized');
  } catch (error) {
    console.error('Failed to set up database change listener:', error);
  }
}

// Show a notification when database updates are detected
function showDatabaseUpdateNotification() {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'database-update-notification';
  notification.textContent = 'Map data updated!';
  
  // Add to document
  document.body.appendChild(notification);
  
  // Remove after a delay
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      notification.remove();
    }, 1000);
  }, 3000);
}

// Generate a checksum of the current database state
async function generateDatabaseHash(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/locations/hash`);
    if (!response.ok) {
      throw new Error(`Failed to fetch database hash: ${response.statusText}`);
    }
    const data = await response.json();
    return data.hash;
  } catch (error) {
    console.error('Error generating database hash:', error);
    return Date.now().toString();
  }
}

// Load metadata - now from database via API instead of direct Prisma access
async function loadDatabaseMetadata(): Promise<Record<string, { lastModified: number }>> {
  try {
    // Try to get cached metadata first
    const cachedMetadata = await locationStore.getItem<Record<string, { lastModified: number }>>(METADATA_CACHE_KEY);
    if (cachedMetadata) {
      return cachedMetadata;
    }

    // Build metadata from API request instead of direct Prisma access
    try {
      const response = await fetch(`${API_BASE_URL}/locations`);
      if (!response.ok) {
        throw new Error(`Failed to fetch locations: ${response.statusText}`);
      }
      const locations = await response.json();
      
      const metadata: Record<string, { lastModified: number }> = {};
      locations.forEach((loc: any) => {
        const path = `locations/${loc.type}/${loc.name.toLowerCase().replace(/\s+/g, '_')}`;
        metadata[path] = { lastModified: loc.lastModified };
      });
      
      // Cache the metadata
      await locationStore.setItem(METADATA_CACHE_KEY, metadata);
      
      return metadata;
    } catch (apiError) {
      console.error('Error fetching location metadata from API:', apiError);
      return {};
    }
  } catch (error) {
    console.warn('Error loading database metadata:', error);
    return {}; // Return empty object if metadata can't be loaded
  }
}

export async function loadLocations(isOfflineMode = false): Promise<(Location & { type: string })[]> {
  try {
    await locationStore.ready(); // Ensure store is ready

    // Get cached data first - we'll need this regardless of online/offline status
    const cachedData = await locationStore.getItem<{
      hash: string, 
      data: (Location & { type: string })[]
    }>(LOCATIONS_CACHE_KEY);
    
    // If we're in offline mode and have cached data, use it right away
    if (isOfflineMode && cachedData) {
      console.log('Using cached locations data in offline mode');
      return cachedData.data;
    } 
    // If offline with no cached data, return empty array (can't proceed)
    else if (isOfflineMode && !cachedData) {
      console.error('No cached data available for offline mode');
      return [];
    }
    
    // If we're online, proceed with normal flow
    const contentHash = await generateContentHash();
    const storedHash = getStoredHash();

    // Use cached data if hashes match and we're online
    if (cachedData && cachedData.hash === contentHash) {
      console.log('Using cached locations data (hashes match)');
      return cachedData.data;
    }

    // If we get here, we need to load fresh data from the API
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressBar = document.querySelector('.loading-progress') as HTMLElement;
    const percentageText = document.querySelector('.loading-percentage') as HTMLElement;
    const loadingText = document.querySelector('.loading-text') as HTMLElement;

    // Show loading overlay first
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }

    const updateProgress = (progress: number, text: string) => {
      console.log(`Loading progress: ${progress}%, ${text}`); 
      if (progressBar && percentageText && loadingText) {
        progressBar.style.width = `${progress}%`;
        percentageText.textContent = `${Math.round(progress)}%`;
        loadingText.textContent = text;
      }
    };

    updateProgress(0, 'Loading location data...');

    try {
      console.log(`Fetching locations from API: ${API_BASE_URL}/locations`);
      // Load locations from API instead of direct DB access
      const response = await fetch(`${API_BASE_URL}/locations`);
      
      if (!response.ok) {
        console.error(`API request failed with status: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`API error details: ${errorText}`);
        throw new Error(`Failed to fetch locations: ${response.statusText}`);
      }
      
      const locations = await response.json();
      
      console.log(`Received ${locations.length} locations from API`);
      if (locations.length > 0) {
        console.log(`Sample location data: ${JSON.stringify(locations[0], null, 2).substring(0, 300)}...`);
      } else {
        console.warn('API returned 0 locations - this may indicate a server-side issue');
      }
      
      updateProgress(50, 'Processing location data...');
      const validLocations = locations.filter((loc: any) => !!loc);

      // Normalize the location data before returning
      const normalizedLocations = validLocations.map((loc: any) => normalizeLocationCoordinates(loc));

      // Cache the new data with hash
      await locationStore.setItem(LOCATIONS_CACHE_KEY, {
        hash: contentHash,
        data: normalizedLocations
      });

      // Store the new hash
      setStoredHash(contentHash);

      updateProgress(100, 'Location data loaded!');
      
      // Hide loading overlay when done
      if (loadingOverlay) {
        setTimeout(() => {
          loadingOverlay.style.display = 'none';
        }, 500); // Short delay for smooth transition
      }

      return normalizedLocations;
    } catch (apiError) {
      console.error("Error loading locations from API:", apiError);
      
      // If we have cached data, use it as fallback
      if (cachedData) {
        console.log('API request failed, using cached data as fallback');
        return cachedData.data;
      }
      
      throw apiError;
    }
  } catch (error) {
    console.error("Error loading location files:", error);
    throw error; // Let the error propagate to show in the UI
  }
}

export async function clearLocationsCache(): Promise<void> {
  try {
    await locationStore.removeItem(LOCATIONS_CACHE_KEY);
    await locationStore.removeItem(METADATA_CACHE_KEY);
  } catch (error) {
    console.error('Error clearing locations cache:', error);
  }
}

// Helper function to normalize coordinate data structure
export function normalizeLocationCoordinates(location: Location & { type: string }): Location & { type: string } {
  if (!location.coordinates || !Array.isArray(location.coordinates)) {
    return location;
  }
  
  // If this is a single coordinate pair [x, y], return it as is
  if (location.coordinates.length === 2 && typeof location.coordinates[0] === 'number' && typeof location.coordinates[1] === 'number') {
    return location;
  }
  
  // Handle the case where coordinates is an array of coordinate pairs or CoordinateProperties
  const normalizedCoords = location.coordinates.map(coord => {
    if (Array.isArray(coord)) {
      // This is a simple coordinate pair [x, y]
      return coord;
    } else if (coord && typeof coord === 'object') {
      // This is a CoordinateProperties object
      // Special case: if it has its own coordinates property (like in tuvalkane.yml)
      if (coord.coordinates) {
        // Make sure the nested coordinates are correctly formatted
        if (Array.isArray(coord.coordinates) && coord.coordinates.length === 2 &&
            typeof coord.coordinates[0] === 'number' && typeof coord.coordinates[1] === 'number') {
          // This is a valid CoordinateProperties object with a nested coordinates pair
          return coord;
        }
        console.warn(`Object has coordinates property but it's not a valid coordinate pair in location ${location.name}:`, coord);
      }
      
      // Invalid or unrecognized format
      console.warn(`Invalid coordinate properties in location ${location.name}:`, coord);
      return [0, 0] as [number, number]; // Fallback
    } else {
      console.warn(`Invalid coordinate format in location ${location.name}:`, coord);
      return [0, 0] as [number, number]; // Fallback
    }
  });
  
  return {
    ...location,
    coordinates: normalizedCoords
  };
}

// Prepare locations for clustering based on zoom level and proximity
export function prepareLocationsForClustering(
  locations: (Location & { type: string })[]
): { 
  clusterable: (Location & { type: string })[], 
  unclustered: (Location & { type: string })[] 
} {
  // Some locations may need to remain unclustered (e.g., important landmarks)
  const clusterable: (Location & { type: string })[] = [];
  const unclustered: (Location & { type: string })[] = [];
  
  locations.forEach(location => {
    // Skip locations without coordinates
    if (!location.coordinates || location.coordinates.length === 0) return;
    
    // Check if location has a property indicating it shouldn't be clustered
    // This allows control over which markers can be clustered
    if (location.noCluster === true) {
      unclustered.push(location);
    } else {
      clusterable.push(location);
    }
  });
  
  return { clusterable, unclustered };
}

// Get location types for use with cluster categorization
export function getLocationTypeGroups(locations: (Location & { type: string })[]): Record<string, string[]> {
  const typeGroups: Record<string, string[]> = {};
  
  locations.forEach(location => {
    if (!typeGroups[location.type]) {
      typeGroups[location.type] = [];
    }
    
    if (!typeGroups[location.type].includes(location.name)) {
      typeGroups[location.type].push(location.name);
    }
  });
  
  return typeGroups;
}

// Helper function to determine cluster icon based on contained marker types
export function determineClusterIcon(cluster: any, locationTypes: Record<string, string[]>): string {
  // Get all markers in this cluster
  const markers = cluster.getAllChildMarkers();
  
  // Count marker types in this cluster
  const typeCounts: Record<string, number> = {};
  let dominantType = '';
  let maxCount = 0;
  
  markers.forEach(marker => {
    // Get location data from marker
    const locationData = marker.options.locationData;
    if (!locationData || !locationData.type) return;
    
    // Count this type
    if (!typeCounts[locationData.type]) {
      typeCounts[locationData.type] = 0;
    }
    typeCounts[locationData.type]++;
    
    // Track dominant type
    if (typeCounts[locationData.type] > maxCount) {
      maxCount = typeCounts[locationData.type];
      dominantType = locationData.type;
    }
  });
  
  // Return appropriate icon class based on dominant type
  if (dominantType) {
    return `cluster-icon-${dominantType.toLowerCase()}`;
  }
  
  // Default cluster icon
  return 'default-cluster-icon';
}