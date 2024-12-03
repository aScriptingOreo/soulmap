// src/index.ts
import { marked } from 'marked';
import { loadLocations, clearLocationsCache } from './loader';
import { initializeMap } from './map';
import { clearTileCache } from './gridLoader'; // Add this import
import { clearDropsCache } from './drops/dropsLoader';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';
import type { VersionInfo } from './types';

async function loadGreeting() {
    try {
        const versionModule = await import('./mapversion.yml');
        const versionData = versionModule.default as VersionInfo;
        const lastSeenVersion = localStorage.getItem('lastSeenVersion');

        // Start loading the map immediately
        const mapInitialization = initMain();
        
        // Show popup if version is different
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
        }

        // Wait for map initialization to complete
        await mapInitialization;
    } catch (error) {
        console.error('Error loading greeting:', error);
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

// Remove map initialization from dismissPopup
function dismissPopup() {
  document.getElementById('popup-overlay')!.style.display = 'none';
}

async function checkForUpdates() {
    try {
        const contentHash = await generateContentHash();
        const storedHash = getStoredHash();

        if (storedHash !== contentHash) {
            // Clear all caches if hash changed
            await Promise.all([
                clearLocationsCache(),
                clearDropsCache(),
                clearTileCache()
            ]);
            setStoredHash(contentHash);
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

async function initMain() {
    try {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        // Check for updates first
        await checkForUpdates();
        
        const urlParams = new URLSearchParams(window.location.search);
        const debug = urlParams.get('debug') === 'true';
        
        // Load locations with progress display
        const locations = await loadLocations().catch(error => {
            console.error("Failed to load locations:", error);
            return [];
        });

        if (locations.length > 0) {
            await initializeMap(locations, debug);
        } else {
            throw new Error("No locations loaded. Map initialization aborted.");
        }
    } catch (error) {
        console.error("Failed to initialize map:", error);
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            const loadingText = loadingOverlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = 'Error loading map. Please refresh the page.';
            }
        }
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