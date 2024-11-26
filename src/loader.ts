// src/loader.ts
import type { Location, VersionInfo } from './types';

const CACHE_KEY = 'soulmap_locations_cache';
// Remove the hardcoded version and import from mapversion.yml
let CACHE_VERSION: string;

export async function loadLocations(): Promise<(Location & { type: string })[]> {
  try {
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

    // Load location data directly
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