// src/index.ts
import { marked } from 'marked';
import { loadLocations, clearLocationsCache } from './loader';
import { initializeMap, updateMetaTags, getMap } from './map';
import { clearTileCache } from './gridLoader';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';
import type { VersionInfo } from './types';
import mapVersion from './mapversion.yml';
import { navigateToLocation, navigateToCoordinates, generateLocationHash } from './search';

// Add offline mode tracking
let isOfflineMode = !navigator.onLine;
const offlineIndicator = document.createElement('div');

// Initialize offline indicator
function setupOfflineIndicator() {
  offlineIndicator.className = 'offline-indicator';
  offlineIndicator.innerHTML = '<span class="material-icons">cloud_off</span> Offline Mode';
  document.body.appendChild(offlineIndicator);
  
  // Initial state
  updateOfflineIndicator();
  
  // Listen for online/offline events
  window.addEventListener('online', handleOnlineStatusChange);
  window.addEventListener('offline', handleOnlineStatusChange);
}

function handleOnlineStatusChange() {
  isOfflineMode = !navigator.onLine;
  updateOfflineIndicator();
}

function updateOfflineIndicator() {
  offlineIndicator.style.display = isOfflineMode ? 'flex' : 'none';
}

// Extract the greeting loading into a separate function that can be reused
async function showGreetingPopup() {
    try {
        const versionData = mapVersion as VersionInfo;
        
        // In offline mode, use cached greeting if possible
        let markdown;
        try {
            const response = await fetch('./greetings.md');
            markdown = await response.text();
        } catch (error) {
            if (isOfflineMode) {
                console.log('Unable to fetch greeting in offline mode');
                return; // Skip greeting in offline mode if fetch fails
            } else {
                throw error; // Re-throw if we're online
            }
        }
        
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

        // Show popup if version is different and not in offline mode
        if (lastSeenVersion !== versionData.version && !isOfflineMode) {
            await showGreetingPopup();
            
            // Store the new version
            localStorage.setItem('lastSeenVersion', versionData.version);
        }
    } catch (error) {
        console.error('Error loading greeting:', error);
    }
}

async function updateVersionDisplay() {
  try {
    const versionData = mapVersion as VersionInfo;
    
    // Create version display box
    const versionDisplay = document.createElement('div');
    versionDisplay.id = 'version-display';
    versionDisplay.className = 'version-box';
    versionDisplay.textContent = `Soulmap | v${versionData.version} | up to date with ${versionData.game_version}`;
    versionDisplay.style.cursor = 'pointer';
    
    // Add click event listener to show the greeting popup
    versionDisplay.addEventListener('click', () => {
      showGreetingPopup();
    });
    
    // Add to document body (sidebar.ts will move it if needed)
    document.body.appendChild(versionDisplay);
  } catch (error) {
    console.error('Error loading version:', error);
  }
}

function dismissPopup() {
  document.getElementById('popup-overlay')!.style.display = 'none';
}

async function checkForUpdates() {
    // Skip update check if offline
    if (isOfflineMode) {
        console.log('Skipping update check in offline mode');
        return;
    }
    
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

        // Check for updates first (will skip if offline)
        await checkForUpdates();
        
        const urlParams = new URLSearchParams(window.location.search);
        const debug = urlParams.get('debug') === 'true';
        
        // Load locations with progress display - passing offline flag
        const locations = await loadLocations(isOfflineMode).catch(error => {
            console.error("Failed to load locations:", error);
            return [];
        });

        if (locations.length > 0) {
            // Initialize the map with locations - this also initializes the sidebar
            const map = await initializeMap(locations);
            
            // If map initialization failed, nothing more to do as the map.ts
            // will display an appropriate error message
            if (!map) {
                console.error("Map initialization failed");
            }
        } else {
            throw new Error("No locations loaded. Map initialization aborted.");
        }
    } catch (error) {
        console.error("Failed to initialize application:", error);
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.innerHTML = `
                <div class="loading-container">
                    <div class="loading-text">Error Loading Application</div>
                    <div class="error-message">${error?.message || 'Unknown error'}</div>
                    <button onclick="location.reload()">Retry</button>
                </div>
            `;
            loadingOverlay.style.display = 'flex';
        }
    }
}

// Create a custom event for URL changes
const urlChangeEvent = new Event('urlchange');

// Add a flag to track history state changes in progress
let historyStateChangeInProgress = false;

// Override History API methods to detect URL changes
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
  if (historyStateChangeInProgress) {
    console.log('Skipping duplicate pushState call during navigation');
    return originalPushState.apply(this, args);
  }
  
  historyStateChangeInProgress = true;
  try {
    originalPushState.apply(this, args);
    window.dispatchEvent(urlChangeEvent);
  } finally {
    setTimeout(() => {
      historyStateChangeInProgress = false;
    }, 0);
  }
};

history.replaceState = function(...args) {
  if (historyStateChangeInProgress) {
    console.log('Skipping duplicate replaceState call during navigation');
    return originalReplaceState.apply(this, args);
  }
  
  historyStateChangeInProgress = true;
  try {
    originalReplaceState.apply(this, args);
    window.dispatchEvent(urlChangeEvent);
  } finally {
    setTimeout(() => {
      historyStateChangeInProgress = false;
    }, 0);
  }
};

// Make internal link handler available globally
(window as any).handleInternalLink = handleInternalLink;

/**
 * Handles navigation to internal links without page reload
 */
function handleInternalLink(url: URL): void {
  const params = url.searchParams;
  const locationParam = params.get('loc');
  const coordParam = params.get('coord');
  const indexParam = params.get('index');
  const hash = url.hash ? url.hash.substring(1) : null; // Extract hash without the #
  
  try {
    // First check for hash-based navigation (fragment identifiers)
    if (hash) {
      console.log('Handling hash navigation:', hash);
      navigateToLocation(hash);
      return;
    }
    
    // Then handle query parameters
    if (locationParam) {
      console.log('Handle internal link - location:', locationParam, 'index:', indexParam);
      
      // Convert from 1-based (URL) to 0-based (internal)
      const internalIndex = indexParam ? Math.max(0, parseInt(indexParam, 10) - 1) : undefined;
      
      // Add detailed logging for debugging complex coordinate structures
      console.log(`Navigating to ${locationParam} with internal index: ${internalIndex} (URL index: ${indexParam})`);
      
      // Call navigateToLocation even if we're handling history navigation
      navigateToLocation(locationParam, internalIndex);
    } 
    else if (coordParam) {
      const coordValues = coordParam.split(',').map(val => parseInt(val.trim(), 10));
      if (coordValues.length === 2 && !isNaN(coordValues[0]) && !isNaN(coordValues[1])) {
        const [x, y] = coordValues;
        // Call navigateToCoordinates even if we're handling history navigation
        navigateToCoordinates([x, y]);
      }
    }
  } catch (error) {
    console.error('Error navigating to internal link:', error);
  }
}

// Event handler for URL changes (both our custom event and popstate)
function handleUrlChange() {
  // Check if we're already handling navigation to prevent loops
  if (window.isHandlingHistoryNavigation) {
    console.log('Already handling navigation, skipping duplicate');
    return;
  }
  
  // Set a flag to prevent double history entries
  window.isHandlingHistoryNavigation = true;
  
  try {
    // Process the new URL
    const url = new URL(window.location.href);
    handleInternalLink(url);
  } finally {
    // Reset the flag after processing
    setTimeout(() => {
      window.isHandlingHistoryNavigation = false;
    }, 100); // Ensure enough time to complete navigation
  }
}

// Listen for URL changes
window.addEventListener('urlchange', handleUrlChange);
window.addEventListener('popstate', handleUrlChange);

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', async () => {
  // Setup offline indicator
  setupOfflineIndicator();
  
  // Add to window for easy access from other modules
  window.isOfflineMode = isOfflineMode;
  
  // Show greeting first
  await loadGreeting();
  await updateVersionDisplay();
  
  // Make generateLocationHash globally accessible for coordinate link handling
  window.generateLocationHash = generateLocationHash;
  
  // Make markers globally accessible for coordinate checks
  window.markersGlobal = [];
  
  // Export important navigation functions to window for global access
  window.navigateToCoordinates = navigateToCoordinates;

  // Initialize the main application after showing the greeting
  await initMain();
  
  // Handle initial navigation after map is loaded
  // This ensures we handle both hash and search parameters
  if (window.location.hash || window.location.search) {
    setTimeout(() => {
      const url = new URL(window.location.href);
      handleInternalLink(url);
    }, 500); // Delay to ensure map is properly initialized
  }
  
  // Set up dismiss handler
  document.querySelector('#popup-content button')?.addEventListener('click', dismissPopup);
});

// Extend window interface for TypeScript
declare global {
  interface Window {
    isOfflineMode: boolean;
    sidebarInstance?: any;
    tempMarker?: any;
    handleInternalLink: (url: URL) => void;
    isHandlingHistoryNavigation?: boolean;
    complexNavigationInProgress?: boolean;  // Add this line
    clickNavigationInProgress?: boolean;    // Add this line
    markersGlobal?: L.Marker[];
    generateLocationHash?: (name: string) => string;
    navigateToCoordinates?: (coords: [number, number]) => void;
  }
}