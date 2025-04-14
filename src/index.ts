import 'leaflet/dist/leaflet.css';
import './styles/main.css';
import './styles/MarkerCluster.css';
import './styles/MarkerCluster.Default.css';
import './styles/leaflet.css';

import { marked } from 'marked';
import { loadLocations, clearLocationsCache, setupDatabaseChangeListener, LOCATION_UPDATE_EVENT } from './loader';
import { initializeMap, updateMetaTags, getMap, refreshMapMarkers } from './map';
import { clearTileCache } from './gridLoader';
import { generateContentHash, getStoredHash, setStoredHash } from './services/hashService';
import type { VersionInfo } from './types';
import mapVersion from './mapversion.yml';
import { navigateToLocation, navigateToCoordinates, generateLocationHash } from './search';
import { DevelopmentOverlay } from './devOverlay';
import analytics from './analytics';

// Flag to detect if we're running in offline mode - use 'let' instead of 'const' to allow reassignment
let isOfflineMode = window.location.search.includes('offline=true') || 
                    window.location.hash.includes('offline') ||
                    localStorage.getItem('offline_mode') === 'true';

// Store cleanup functions for proper resource management
let cleanupFunctions: (() => void)[] = [];

// Update the documentation URL
const docUrl = 'https://github.com/oreo-map/soulmap';

// Show error message when an unhandled error occurs
function showError(message: string) {
  const errorContainer = document.createElement('div');
  errorContainer.className = 'error-container';
  errorContainer.innerHTML = `
    <div class="error-message">
      <h2>Error</h2>
      <p>${message}</p>
      <button id="reload-btn">Reload</button>
      <button id="clear-cache-btn">Clear Cache & Reload</button>
    </div>
  `;
  document.body.appendChild(errorContainer);
  
  document.getElementById('reload-btn')?.addEventListener('click', () => window.location.reload());
  document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
    try {
      await clearLocationsCache();
      await clearTileCache();
      window.location.reload();
    } catch (e) {
      console.error('Error clearing cache:', e);
      window.location.reload();
    }
  });
}

// Show notification for non-error messages
function showNotification(message: string, type: 'info' | 'warning' | 'success' = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `<p>${message}</p>`;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 3000);
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
    console.log('Starting application initialization...');
    
    // Check if browser is offline and update offline mode
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      if (!navigator.onLine) {
        isOfflineMode = true;
        console.log('Browser is offline, enabling offline mode');
      }
    }
    
    // Load map locations
    console.log('Loading locations...');
    const locations = await loadLocations(isOfflineMode);
    
    console.log(`Loaded ${locations ? locations.length : 0} locations`);
    
    // Check if we have any locations
    if (!locations || locations.length === 0) {
      console.warn('No locations loaded from API. Using default locations instead.');
      // Use some default locations to prevent the map from failing to initialize
      const defaultLocations = [
        {
          name: "Starting Point",
          coordinates: [500, 500],
          description: "Default location when no data is available.",
          type: "default"
        }
      ];
      
      // Initialize the map with default locations
      console.log('Initializing map with default locations');
      initializeMap(defaultLocations);
      
      // Show a notification to the user
      showNotification('No location data available. Please check server connection.', 'warning');
      
      return;
    }
    
    // Initialize the map with the loaded locations
    console.log(`Initializing map with ${locations.length} loaded locations`);
    const map = await initializeMap(locations);
    
    // Set up database change listener to enable real-time updates
    const cleanupSSE = await setupDatabaseChangeListener(async () => {
      try {
        // This is a fallback for older code - the actual updates
        // will be handled by event listeners in each component
        console.log('Database change detected, refreshing...');
        
        // No need to reload the page, just fetch fresh locations
        const freshLocations = await loadLocations(isOfflineMode);
        
        // Map will update via the LOCATION_UPDATE_EVENT
        return;
      } catch (error) {
        console.error('Error handling database change:', error);
      }
    });
    
    // Add cleanup function
    if (cleanupSSE) {
      cleanupFunctions.push(cleanupSSE);
    }
    
    // Set up cleanup on page unload
    window.addEventListener('beforeunload', () => {
      cleanupFunctions.forEach(cleanup => {
        try {
          cleanup();
        } catch (e) {
          console.warn('Error during cleanup:', e);
        }
      });
    });
    
    // Listen for network status changes but don't show notifications
    window.addEventListener('online', () => {
      if (isOfflineMode) {
        // Just log the status change instead of showing notification
        console.log('Internet connection detected. Offline mode still active.');
      }
    });
    
    window.addEventListener('offline', () => {
      // Just update offline mode without showing notification
      console.log('Internet connection lost. Switched to offline mode.');
      isOfflineMode = true;
    });

    // Log initialization complete
    console.log('Application initialized successfully');
    
    // Track page view in analytics - with error handling
    try {
      if (analytics && typeof analytics.trackPageView === 'function') {
        analytics.trackPageView('map');
      }
    } catch (error) {
      console.warn('Error tracking page view:', error);
    }
    
  } catch (error) {
    console.error('Failed to load locations:', error);
    showError('Failed to initialize application. Please try again later.');
    throw new Error('No locations loaded. Map initialization aborted.');
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

// Define global namespace for TypeScript
declare global {
  interface Window {
    isHandlingHistoryNavigation?: boolean;
    sidebarInstance?: any;
    markersGlobal?: any;
    clickNavigationInProgress?: boolean;
    complexNavigationInProgress?: boolean;
    lastNavigatedLocation?: string;
    lastNavigatedIndex?: number;
    navigationTimeout?: number;
    navigationInProgress?: boolean;
    generateLocationHash?: (name: string) => string;
    navigateToCoordinates?: (coords: [number, number]) => void;
    navigateToLocation?: (locationSlug: string, coordIndex?: number) => void;
    handleInternalLink?: (url: URL) => void;
  }
}

// Make navigation functions available globally
window.generateLocationHash = generateLocationHash;
window.navigateToLocation = navigateToLocation;
window.navigateToCoordinates = navigateToCoordinates;

// Handle navigation through internal links
window.handleInternalLink = (url: URL) => {
  try {
    if (url.searchParams.has('coord')) {
      // Handle coordinate navigation
      const coordString = url.searchParams.get('coord');
      if (coordString) {
        const [x, y] = coordString.split(',').map(Number);
        if (!isNaN(x) && !isNaN(y)) {
          navigateToCoordinates([x, y]);
        }
      }
    } else if (url.searchParams.has('loc')) {
      // Handle location navigation
      const locationSlug = url.searchParams.get('loc');
      const indexParam = url.searchParams.get('index');
      const index = indexParam ? parseInt(indexParam, 10) - 1 : undefined;
      
      if (locationSlug) {
        navigateToLocation(locationSlug, index);
      }
    }
  } catch (e) {
    console.error('Error handling internal link:', e);
  }
};

// Add global error handler
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
  showError('An unexpected error occurred. Please try reloading the page.');
});

// Add this to handle errors in promises
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  if (event.reason.stack) {
    console.error('Stack trace:', event.reason.stack);
  }
});

// Set up initial state
window.isHandlingHistoryNavigation = false;

// Listen for hard refresh detection
document.addEventListener('DOMContentLoaded', () => {
  // Check if this was a hard refresh
  const navEntries = performance.getEntriesByType('navigation');
  const isHardRefresh = navEntries.length > 0 && 
    (navEntries[0] as any).type === 'reload' && 
    (navEntries[0] as any).loadType === 'hard';
  
  if (isHardRefresh) {
    console.log('Hard refresh detected (Ctrl+F5) - will reload all data');
  }
});

// Main application initialization
async function initializeApplication() {
  try {
    // Get query parameters
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for debug mode
    window.isDebugEnabled = urlParams.has('debug') || localStorage.getItem('debug_mode') === 'true';
    
    // Load locations - this now includes hash verification
    const locations = await loadLocations();
    console.log(`Loaded ${locations.length} locations`);
    
    // Initialize map with locations
    const map = await initializeMap(locations, window.isDebugEnabled);
    
    // Set up URL navigation handlers
    window.handleInternalLink = (url: URL) => {
      const urlParams = new URLSearchParams(url.search);
      const locParam = urlParams.get('loc');
      const coordParam = urlParams.get('coord');
      
      window.isHandlingHistoryNavigation = true;
      
      try {
        if (locParam && window.navigateToLocation) {
          const indexParam = urlParams.get('index');
          const index = indexParam ? parseInt(indexParam, 10) - 1 : undefined;
          window.navigateToLocation(locParam, index);
        } else if (coordParam && window.navigateToCoordinates) {
          const [x, y] = coordParam.split(',').map(Number);
          if (!isNaN(x) && !isNaN(y)) {
            window.navigateToCoordinates([x, y]);
          }
        }
      } finally {
        // Reset the flag after navigation
        setTimeout(() => {
          window.isHandlingHistoryNavigation = false;
        }, 200);
      }
    };
    
    // Set up database change listener to listen for real-time updates
    const cleanup = await setupDatabaseChangeListener(async () => {
      // This is the callback for when a database change is detected
      console.log('Database change detected via SSE');
    });
    
    // Add debug overlay if needed
    if (window.isDebugEnabled && map) {
      new DevelopmentOverlay(map);
    }
    
    // Expose utility functions for refreshing and clearing caches
    window.clearCaches = async () => {
      await clearLocationsCache();
      await clearTileCache();
      console.log('All caches cleared');
      
      // Show notification
      const notification = document.createElement('div');
      notification.className = 'database-update-notification';
      notification.textContent = 'All caches cleared';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
    };
    
    window.refreshMapData = async () => {
      try {
        // Clear only locations cache to force a refresh
        await clearLocationsCache();
        
        // Load fresh locations
        const freshLocations = await loadLocations();
        
        // Update map markers
        await refreshMapMarkers(freshLocations);
        
        console.log('Map data refreshed successfully');
        
        // Show notification
        const notification = document.createElement('div');
        notification.className = 'database-update-notification';
        notification.textContent = 'Map data refreshed';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
        
        return true;
      } catch (error) {
        console.error('Error refreshing map data:', error);
        return false;
      }
    };
    
    // Log initialization complete
    console.log('Application initialized successfully');
    
    // Track page view in analytics - with error handling
    try {
      if (analytics && typeof analytics.trackPageView === 'function') {
        analytics.trackPageView('map');
      }
    } catch (error) {
      console.warn('Error tracking page view:', error);
    }
    
  } catch (error) {
    console.error('Error initializing application:', error);
    
    // Show error to user
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fatal-error';
    errorDiv.innerHTML = `
      <h2>Application Error</h2>
      <p>There was an error initializing the application. Please try refreshing the page.</p>
      <pre>${error.message}</pre>
      <button id="refresh-btn">Refresh Page</button>
    `;
    document.body.appendChild(errorDiv);
    
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

// Start the application
initializeApplication();