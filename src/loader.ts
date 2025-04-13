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

// Create a custom event for location updates
const LOCATIONS_UPDATED_EVENT = 'locationsUpdated';

// Function to broadcast location updates to all components
function broadcastLocationsUpdate(locations: (Location & { type: string })[]) {
  const event = new CustomEvent(LOCATIONS_UPDATED_EVENT, { 
    detail: { locations, timestamp: Date.now() } 
  });
  console.log(`Broadcasting location update with ${locations.length} locations`);
  document.dispatchEvent(event);
}

// Setup the refresh function that can be called when database changes occur
export async function setupDatabaseChangeListener(refreshCallback: () => Promise<void>) {
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const INITIAL_RECONNECT_DELAY = 1000;
  
  // Track last data refresh time to prevent over-refreshing
  let lastRefreshTime = Date.now();
  const MIN_REFRESH_INTERVAL = 10000; // 10 seconds minimum between refreshes
  
  function connect() {
    // Close any existing connection first
    if (eventSource) {
      try {
        eventSource.close();
      } catch (e) {
        console.warn('Error closing previous EventSource:', e);
      }
      eventSource = null;
    }
    
    try {
      console.log(`Connecting to SSE endpoint: ${API_BASE_URL}/listen`);
      eventSource = new EventSource(`${API_BASE_URL}/listen`);
      
      eventSource.onopen = () => {
        console.log('SSE connection established');
        reconnectAttempts = 0; // Reset reconnect counter on successful connection
      };
      
      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'connected') {
            console.log('Successfully connected to the SSE stream');
          } else if (data.type === 'change' && !refreshInProgress) {
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
              
              // Load fresh locations directly without full page refresh
              const freshLocations = await fetchLocationsFromAPI();
              if (freshLocations && freshLocations.length > 0) {
                // Update the cache with new data
                await updateLocationCache(freshLocations);
                
                // Broadcast the updated locations to all components
                broadcastLocationsUpdate(freshLocations);
              }
              
              // Still call the original callback for backward compatibility
              await refreshCallback();
            } catch (error) {
              console.error('Error refreshing locations after database change:', error);
            } finally {
              refreshInProgress = false;
            }
          } else if (data.type === 'ping' && !refreshInProgress) {
            // For ping events, handle them more intelligently
            const timeSinceLastRefresh = Date.now() - lastRefreshTime;
            
            // Only check every 5 minutes to drastically reduce unnecessary refreshes
            if (timeSinceLastRefresh > 300000) { // 5 minutes
              console.log('Performing periodic hash check...');
              
              try {
                // Fetch database hash to see if anything changed
                const newHash = await generateDatabaseHash();
                const cachedData = await locationStore.getItem<{ hash: string }>(LOCATIONS_CACHE_KEY);
                
                // Skip invalid hashes completely
                if (!newHash || newHash.startsWith('error-')) {
                  console.log('Skipping hash check due to invalid hash');
                  return;
                }
                
                // Compare the hashes to detect actual changes
                if (cachedData && cachedData.hash && cachedData.hash !== newHash) {
                  // Important: Double-check with a second hash request to avoid false positives
                  const confirmationHash = await generateDatabaseHash();
                  
                  if (confirmationHash === newHash && confirmationHash !== cachedData.hash) {
                    console.log('Database change confirmed via hash check, refreshing locations...');
                    
                    refreshInProgress = true;
                    try {
                      lastRefreshTime = Date.now();
                      
                      // Load fresh locations
                      const freshLocations = await fetchLocationsFromAPI();
                      if (freshLocations && freshLocations.length > 0) {
                        // Update cache with new data
                        await updateLocationCache(freshLocations);
                        
                        // Broadcast updated locations to components
                        broadcastLocationsUpdate(freshLocations);
                        
                        // Only show notification AFTER successfully loading new data
                        showDatabaseUpdateNotification();
                      }
                      
                      // Also call original callback for backward compatibility
                      await refreshCallback();
                    } finally {
                      refreshInProgress = false;
                    }
                  } else {
                    console.log('Ignoring false positive hash change');
                  }
                } else {
                  console.log('No database changes detected during hash check');
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
        
        // Close the current connection
        if (eventSource) {
          try {
            eventSource.close();
          } catch (e) {
            // Ignore errors during cleanup
          }
          eventSource = null;
        }
        
        // Implement exponential backoff for reconnection
        reconnectAttempts++;
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1),
          60000 // Max 1 minute delay
        );
        
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connect, delay);
        } else {
          console.warn('Maximum reconnection attempts reached. Falling back to periodic refresh.');
          
          // Set up a fallback refresh interval
          setInterval(async () => {
            if (!refreshInProgress) {
              try {
                console.log('Performing fallback refresh check');
                const newHash = await generateDatabaseHash();
                const cachedData = await locationStore.getItem<{ hash: string }>(LOCATIONS_CACHE_KEY);
                
                if (cachedData && cachedData.hash !== newHash) {
                  console.log('Change detected during fallback refresh');
                  refreshInProgress = true;
                  
                  try {
                    lastRefreshTime = Date.now();
                    
                    // Load fresh locations directly
                    const freshLocations = await fetchLocationsFromAPI();
                    if (freshLocations && freshLocations.length > 0) {
                      await updateLocationCache(freshLocations);
                      broadcastLocationsUpdate(freshLocations);
                    }
                    
                    await refreshCallback();
                  } finally {
                    refreshInProgress = false;
                  }
                }
              } catch (error) {
                console.error('Error in fallback refresh:', error);
              }
            }
          }, 30000); // Check every 30 seconds
        }
      };
    } catch (error) {
      console.error('Failed to set up database change listener:', error);
    }
  }
  
  // Start the initial connection
  connect();
  
  // Return a cleanup function
  return () => {
    if (eventSource) {
      console.log('Cleaning up SSE connection');
      try {
        eventSource.close();
      } catch (e) {
        console.warn('Error closing EventSource during cleanup:', e);
      }
      eventSource = null;
    }
  };
}

// Function to fetch locations directly from API
async function fetchLocationsFromAPI(): Promise<(Location & { type: string })[] | null> {
  try {
    console.log(`Fetching locations from API: ${API_BASE_URL}/locations`);
    const response = await fetch(`${API_BASE_URL}/locations`);
    
    if (!response.ok) {
      console.error(`API request failed with status: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`API error details: ${errorText}`);
      throw new Error(`Failed to fetch locations: ${response.statusText}`);
    }
    
    const locations = await response.json();
    console.log(`Received ${locations.length} locations from API`);
    
    // Normalize the location data before returning
    const normalizedLocations = locations.filter((loc: any) => !!loc)
      .map((loc: any) => normalizeLocationCoordinates(loc));
    
    return normalizedLocations;
  } catch (error) {
    console.error("Error fetching locations from API:", error);
    return null;
  }
}

// Function to update the locations cache
async function updateLocationCache(locations: (Location & { type: string })[]): Promise<void> {
  try {
    const contentHash = await generateContentHash();
    await locationStore.setItem(LOCATIONS_CACHE_KEY, {
      hash: contentHash,
      data: locations
    });
    setStoredHash(contentHash);
    console.log(`Updated location cache with ${locations.length} locations`);
  } catch (error) {
    console.error('Error updating location cache:', error);
  }
}

// Show a notification when database updates are detected
function showDatabaseUpdateNotification() {
  // Create notification element - MAKE THIS LESS VISIBLE
  const notification = document.createElement('div');
  notification.className = 'database-update-notification low-priority';
  notification.textContent = 'Map data updated';
  notification.style.cssText = 'opacity: 0.7; font-size: 0.8em; padding: 5px 10px;';
  
  // Add to document
  document.body.appendChild(notification);
  
  // Remove after a short delay
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 2000); // Show for just 2 seconds instead of 3
}

// Generate a checksum of the current database state
async function generateDatabaseHash(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/locations/hash`);
    if (!response.ok) {
      console.warn(`Hash API returned error status: ${response.status}`);
      return `error-api-${Date.now()}`;
    }
    
    const data = await response.json();
    
    // Validate the hash format
    if (!data.hash) {
      console.warn('Invalid hash format received from API');
      return `error-format-${Date.now()}`;
    }
    
    // If the hash contains error indicators, don't process it
    if (data.hash.startsWith('error-')) {
      console.log(`Server reported hash generation issue: ${data.hash}`);
      return data.hash;
    }
    
    return data.hash;
  } catch (error) {
    console.error('Error generating database hash:', error);
    return `error-client-${Date.now()}`;
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
      if (locations.length === 0) {
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

// Export the event name for other modules to listen for location updates
export const LOCATION_UPDATE_EVENT = LOCATIONS_UPDATED_EVENT;