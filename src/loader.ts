// src/loader.ts
import type { Location, VersionInfo } from './types';

const CACHE_KEY = 'soulmap_locations_cache';
// Remove the hardcoded version and import from mapversion.yml
let CACHE_VERSION: string;

export async function loadLocations(): Promise<(Location & { type: string })[]> {
  try {
    // Get version from mapversion.yml
    const versionModule = await import('./mapversion.yml');
    const versionData = versionModule.default as VersionInfo;
    CACHE_VERSION = versionData.version;

    const loadingOverlay = document.getElementById('loading-overlay');
    const progressBar = document.querySelector('.loading-progress') as HTMLElement;
    const percentageText = document.querySelector('.loading-percentage') as HTMLElement;
    const loadingText = document.querySelector('.loading-text') as HTMLElement;

    const updateProgress = (progress: number, text: string) => {
      if (progressBar && percentageText && loadingText) {
        progressBar.style.width = `${progress}%`;
        percentageText.textContent = `${Math.round(progress)}%`;
        loadingText.textContent = text;
      }
    };

    // Show loading overlay
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }

    // Check cache with dynamic version
    const cachedData = localStorage.getItem(CACHE_KEY);
    const cachedVersion = localStorage.getItem(`${CACHE_KEY}_version`);
    
    if (cachedData && cachedVersion === CACHE_VERSION) {
      updateProgress(25, 'Loading cached data...');
      const locations = JSON.parse(cachedData);
      updateProgress(50, 'Initializing map...');
      return locations;
    }

    // If no cache or outdated, load from files
    updateProgress(0, 'Loading location data...');
    const importLocations = import.meta.glob('./locations/*/*.y?(a)ml');
    const totalFiles = Object.keys(importLocations).length;
    let loaded = 0;

    const locations = await Promise.all(
      Object.entries(importLocations).map(async ([path, importFn]) => {
        const module = await importFn();
        loaded++;
        updateProgress((loaded / totalFiles) * 50, 'Loading location data...');
        return { ...module.default, type: path.split('/')[2] };
      })
    );

    // Cache the loaded data
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(locations));
      localStorage.setItem(`${CACHE_KEY}_version`, CACHE_VERSION);
    } catch (error) {
      console.warn('Failed to cache locations:', error);
    }

    updateProgress(50, 'Initializing map...');
    return locations;

  } catch (error) {
    console.error("Error loading location files:", error);
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
    return [];
  }
}

// Add a function to clear the cache if needed
export function clearLocationsCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(`${CACHE_KEY}_version`);
}