// src/loader.ts
import type { Location, VersionInfo } from './types';
import localforage from 'localforage';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';

const LOCATIONS_CACHE_KEY = 'soulmap_locations_cache';

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

export async function loadLocations(): Promise<(Location & { type: string })[]> {
  try {
    await locationStore.ready(); // Ensure store is ready

    const contentHash = await generateContentHash();
    const storedHash = getStoredHash();

    // Use cached data if hashes match
    const cachedData = await locationStore.getItem<{
      hash: string, 
      data: (Location & { type: string })[]
    }>(LOCATIONS_CACHE_KEY);
    
    if (cachedData && cachedData.hash === contentHash) {
      console.log('Using cached locations data');
      return cachedData.data;
    }

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
          return { ...module.default, type: path.split('/')[2] };
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
  } catch (error) {
    console.error('Error clearing locations cache:', error);
  }
}