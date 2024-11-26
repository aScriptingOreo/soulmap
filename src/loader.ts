// src/loader.ts
import type { Location } from './types';

// Function to load all location YAML files
export async function loadLocations(): Promise<(Location & { type: string })[]> {
  const importLocations = import.meta.glob('./locations/*/*.y?(a)ml');
  const totalFiles = Object.keys(importLocations).length;

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

  try {
    // Show loading overlay
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }

    // Phase 1: Load YAML files (0-50%)
    updateProgress(0, 'Loading location data...');
    let loaded = 0;

    const locations = await Promise.all(
      Object.entries(importLocations).map(async ([path, importFn]) => {
        const module = await importFn();
        loaded++;
        updateProgress((loaded / totalFiles) * 50, 'Loading location data...');
        return { ...module.default, type: path.split('/')[2] };
      })
    );

    // Phase 2: Initialize map components (50-100%)
    updateProgress(50, 'Initializing map...');

    // Return locations but don't hide overlay yet
    return locations;
  } catch (error) {
    console.error("Error loading location files:", error);
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
    return [];
  }
}