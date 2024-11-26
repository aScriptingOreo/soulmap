// src/index.ts
import { marked } from 'marked';
import { loadLocations, clearLocationsCache } from './loader';
import { initializeMap } from './map';
import type { VersionInfo } from './types';

async function loadGreeting() {
  try {
    const versionModule = await import('./mapversion.yml');
    const versionData = versionModule.default as VersionInfo;
    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
    
    // Only show popup if version is different
    if (lastSeenVersion !== versionData.version) {
      const response = await fetch('./greetings.md');
      let markdown = await response.text();
      
      // Replace version placeholders
      markdown = markdown.replace('{version}', versionData.version)
                       .replace('{game_version}', versionData.game_version);
      
      const html = marked(markdown);
      
      const popupText = document.getElementById('popup-text');
      if (popupText) {
        popupText.innerHTML = html;
        document.getElementById('popup-overlay')!.style.display = 'flex';
      }
      
      // Store the new version
      localStorage.setItem('lastSeenVersion', versionData.version);
    } else {
      // If same version, skip popup and initialize map directly
      initMain();
    }
  } catch (error) {
    console.error('Error loading greeting:', error);
    // Fallback to init main in case of error
    initMain();
  }
}

async function updateVersionDisplay() {
  try {
    const versionModule = await import('./mapversion.yml');
    const versionData = versionModule.default as VersionInfo;
    
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
      versionDisplay.textContent = `Soulmap | v${versionData.version} | up to date with ${versionData.game_version}`;
    }
  } catch (error) {
    console.error('Error loading version:', error);
  }
}

function dismissPopup() {
  document.getElementById('popup-overlay')!.style.display = 'none';
  // Initialize map after dismissing popup
  initMain();
}

async function checkForUpdates() {
    try {
        const versionModule = await import('./mapversion.yml');
        const currentVersion = versionModule.default.version;
        const lastVersion = localStorage.getItem('soulmap_version');

        if (lastVersion !== currentVersion) {
            // Clear both location and tile caches if version changed
            clearLocationsCache();
            clearTileCache();
            localStorage.setItem('soulmap_version', currentVersion);
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

async function initMain() {
    await checkForUpdates();
    const urlParams = new URLSearchParams(window.location.search);
    const debug = urlParams.get('debug') === 'true';
    
    const locations = await loadLocations();
    if (locations.length > 0) {
        // Initialize map with locations
        await initializeMap(locations, debug);
    } else {
        console.error("No locations loaded. Map initialization aborted.");
    }
}

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', async () => {
  // Show greeting first
  await loadGreeting();
  await updateVersionDisplay();
  
  // Set up dismiss handler
  document.querySelector('#popup-content button')?.addEventListener('click', dismissPopup);
});