// src/loader.ts
import type { Location, VersionInfo } from './types';
import localforage from 'localforage';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';

const LOCATIONS_CACHE_KEY = 'soulmap_locations_cache';
const METADATA_CACHE_KEY = 'soulmap_metadata_cache';

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

// Load file metadata from Vite's development server or static JSON in production
async function loadFileMetadata(): Promise<Record<string, { lastModified: number }>> {
  try {
    // Try to get cached metadata first
    const cachedMetadata = await locationStore.getItem<Record<string, { lastModified: number }>>(METADATA_CACHE_KEY);
    if (cachedMetadata) {
      return cachedMetadata;
    }

    // If no cached metadata, fetch from server API endpoint
    const response = await fetch('/api/file-metadata');
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }

    const metadata = await response.json();
    
    // Cache the metadata
    await locationStore.setItem(METADATA_CACHE_KEY, metadata);
    
    return metadata;
  } catch (error) {
    console.warn('Error loading file metadata:', error);
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

    // Fetch file metadata (will be used later)
    let fileMetadata = {};
    try {
      fileMetadata = await loadFileMetadata();
    } catch (error) {
      console.warn('Failed to load file metadata, continuing with cache if available');
    }

    // Use cached data if hashes match and we're online
    if (cachedData && cachedData.hash === contentHash) {
      console.log('Using cached locations data (hashes match)');
      
      // Even if using cached data, update the lastModified timestamps
      // from the latest metadata (in case files were modified)
      const updatedData = cachedData.data.map(location => {
        const filePath = `src/locations/${location.type}/${location.name.toLowerCase().replace(/\s+/g, '_')}.yml`;
        const metadata = fileMetadata[filePath];
        
        return {
          ...location,
          lastModified: metadata?.lastModified || location.lastModified
        };
      });
      
      return updatedData;
    }

    // If we get here, we need to load fresh data from the server
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressBar = document.querySelector('.loading-progress') as HTMLElement;
    const percentageText = document.querySelector('.loading-percentage') as HTMLElement;
    const loadingText = document.querySelector('.loading-text') as HTMLElement;

    // Show loading overlay first
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }

    const updateProgress = (progress: number, text: string) => {
      console.log(`Loading progress: ${progress}%, ${text}`); // Add debug logging
      if (progressBar && percentageText && loadingText) {
        progressBar.style.width = `${progress}%`;
        percentageText.textContent = `${Math.round(progress)}%`;
        loadingText.textContent = text;
      }
    };

    updateProgress(0, 'Loading location data...');

    // If no cache or version mismatch, load from files
    const importLocations = import.meta.glob('./locations/*/*.y?(a)ml');
    const totalFiles = Object.keys(importLocations).length;
    let loaded = 0;

    if (totalFiles === 0) {
      throw new Error('No location files found');
    }

    const locations = await Promise.all(
      Object.entries(importLocations).map(async ([path, importFn]) => {
        try {
          const module = await importFn();
          loaded++;
          const progress = (loaded / totalFiles) * 50;
          updateProgress(progress, 'Loading location data...');
          
          // Use real file lastModified from metadata if available
          const relativePath = path.replace(/^\.\//, ''); // Remove leading ./
          const metadata = fileMetadata[relativePath];
          const lastModified = metadata?.lastModified || Date.now();
          
          return { 
            ...module.default, 
            type: path.split('/')[2],
            lastModified
          };
        } catch (error) {
          console.error(`Error loading location file: ${path}`, error);
          return null;
        }
      })
    );

    updateProgress(50, 'Initializing map...');
    const validLocations = locations.filter((loc): loc is Location & { type: string } => loc !== null);

    // Cache the new data with hash
    await locationStore.setItem(LOCATIONS_CACHE_KEY, {
      hash: contentHash,
      data: validLocations
    });

    // Store the new hash
    setStoredHash(contentHash);

    return validLocations;
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