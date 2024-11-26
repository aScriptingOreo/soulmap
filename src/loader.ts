// src/loader.ts
import type { Location, VersionInfo } from './types';

const CACHE_KEY = 'soulmap_locations_cache';
// Remove the hardcoded version and import from mapversion.yml
let CACHE_VERSION: string;

export async function loadLocations(): Promise<(Location & { type: string })[]> {
  try {
    // Load version first
    const versionModule = await import('./mapversion.yml');
    CACHE_VERSION = versionModule.default.game_version;

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

    // Load and process locations
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
    return locations.filter((loc): loc is Location & { type: string } => loc !== null);

  } catch (error) {
    console.error("Error loading location files:", error);
    throw error; // Let the error propagate to show in the UI
  }
}

// Add a function to clear the cache if needed
export function clearLocationsCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(`${CACHE_KEY}_version`);
}