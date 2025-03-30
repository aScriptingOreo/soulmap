// src/index.ts
import { marked } from 'marked';
import { loadLocations, clearLocationsCache } from './loader';
import { initializeMap } from './map';
import { clearTileCache } from './gridLoader';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';
import type { VersionInfo } from './types';
import mapVersion from './mapversion.yml';

// Extract the greeting loading into a separate function that can be reused
async function showGreetingPopup() {
    try {
        const versionData = mapVersion as VersionInfo;
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
    } catch (error) {
        console.error('Error showing greeting popup:', error);
    }
}

async function loadGreeting() {
    try {
        const versionData = mapVersion as VersionInfo;
        const lastSeenVersion = localStorage.getItem('lastSeenVersion');

        // Start loading the map immediately
        const mapInitialization = initMain();
        
        // Show popup if version is different
        if (lastSeenVersion !== versionData.version) {
            await showGreetingPopup();
            
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
    const versionData = mapVersion as VersionInfo;
    
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
      versionDisplay.textContent = `Soulmap | v${versionData.version} | up to date with ${versionData.game_version}`;
      
      // Add cursor style to indicate it's clickable
      versionDisplay.style.cursor = 'pointer';
      
      // Add click event listener to show the greeting popup
      versionDisplay.addEventListener('click', () => {
        showGreetingPopup();
      });
    }
  } catch (error) {
    console.error('Error loading version:', error);
  }
}

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