/**
 * Visibility Middleware Service
 * Only stores markers that are hidden (false visibility)
 * All markers are considered visible by default
 * Uses localforage for persistent storage
 */
import localforage from 'localforage';
import { getDefaultsConfig, isFirstLoad, markFirstLoadCompleted } from './defaultVisibilityService';

// LocalForage store for visibility preferences
const visibilityStore = localforage.createInstance({
  name: 'soulmap-visibility',
  description: 'Storage for marker and category visibility preferences',
  driver: [
    localforage.INDEXEDDB,
    localforage.WEBSQL,
    localforage.LOCALSTORAGE
  ],
  storeName: 'visibility-prefs'
});

// Storage keys
const HIDDEN_MARKERS_KEY = 'hidden_markers';
const HIDDEN_CATEGORIES_KEY = 'hidden_categories';

/**
 * Cache of hidden markers and categories
 */
let hiddenMarkers = new Set<string>();
let hiddenCategories = new Set<string>();
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the visibility middleware
 */
export async function initVisibilityMiddleware(): Promise<void> {
  if (isInitialized) return;

  try {
    // First load cached preferences from localStorage
    loadVisibilityState();

    // If this is the first load, apply default visibility settings
    if (isFirstLoad()) {
      console.log('First load detected, applying default visibility settings');
      
      const defaults = getDefaultsConfig();
      
      // Apply default hidden categories
      if (defaults.hiddenCategories && Array.isArray(defaults.hiddenCategories)) {
        defaults.hiddenCategories.forEach(category => {
          // Only hide if the user hasn't explicitly set visibility
          if (!hiddenCategories.has(category)) {
            console.log(`Hiding category by default: ${category}`);
            hiddenCategories.add(category);
          }
        });
      }
      
      // Apply default hidden markers
      if (defaults.hiddenMarkers && Array.isArray(defaults.hiddenMarkers)) {
        defaults.hiddenMarkers.forEach(marker => {
          // Only hide if the user hasn't explicitly set visibility
          if (!hiddenMarkers.has(marker)) {
            console.log(`Hiding marker by default: ${marker}`);
            hiddenMarkers.add(marker);
          }
        });
      }
      
      // Save the updated visibility state
      saveVisibilityState();
      
      // Mark first load as completed
      markFirstLoadCompleted();
    }

    isInitialized = true;
  } catch (error) {
    console.error('Error initializing visibility middleware:', error);
    hiddenMarkers = new Set();
    hiddenCategories = new Set();
    isInitialized = true;
  }
}

/**
 * Internal initialization function
 */
async function initializeStore(): Promise<void> {
  if (isInitialized) return;
  
  try {
    await visibilityStore.ready();
    
    // First try to load from localforage
    let markersArray = await visibilityStore.getItem<string[]>(HIDDEN_MARKERS_KEY);
    let categoriesArray = await visibilityStore.getItem<string[]>(HIDDEN_CATEGORIES_KEY);
    
    // If no data in localforage, try to migrate from localStorage
    if (!markersArray) {
      const legacyMarkersJson = localStorage.getItem('soulmap_hidden_markers');
      if (legacyMarkersJson) {
        markersArray = JSON.parse(legacyMarkersJson);
        // Migrate to localforage
        await visibilityStore.setItem(HIDDEN_MARKERS_KEY, markersArray);
        // Remove from localStorage to avoid duplication
        localStorage.removeItem('soulmap_hidden_markers');
      }
    }
    
    if (!categoriesArray) {
      const legacyCategoriesJson = localStorage.getItem('soulmap_hidden_categories');
      if (legacyCategoriesJson) {
        categoriesArray = JSON.parse(legacyCategoriesJson);
        // Migrate to localforage
        await visibilityStore.setItem(HIDDEN_CATEGORIES_KEY, categoriesArray);
        // Remove from localStorage to avoid duplication
        localStorage.removeItem('soulmap_hidden_categories');
      }
    }
    
    // Initialize our in-memory sets
    if (markersArray && markersArray.length) {
      hiddenMarkers = new Set(markersArray);
    }
    
    if (categoriesArray && categoriesArray.length) {
      hiddenCategories = new Set(categoriesArray);
    }
    
    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize visibility middleware:', error);
    hiddenMarkers = new Set();
    hiddenCategories = new Set();
    isInitialized = true; // Mark as initialized to avoid repeated errors
  }
}

/**
 * Check if a marker should be visible
 * @param markerId - The marker ID to check
 * @param category - The category of the marker
 * @returns true if the marker should be visible, false otherwise
 */
export function isMarkerVisible(markerId: string, category?: string): boolean {
  // If not initialized, we default to visible
  if (!isInitialized) {
    return true;
  }
  
  // If the marker or its category is hidden, return false
  if (hiddenMarkers.has(markerId)) {
    return false;
  }
  
  if (category && hiddenCategories.has(category)) {
    return false;
  }
  
  // By default, markers are visible
  return true;
}

/**
 * Set a marker's visibility
 * @param markerId - The marker ID to set visibility for
 * @param visible - Whether the marker should be visible
 */
export async function setMarkerVisibility(markerId: string, visible: boolean): Promise<void> {
  await initVisibilityMiddleware();
  
  if (visible) {
    // If making visible, just remove from hidden set
    hiddenMarkers.delete(markerId);
  } else {
    // If hiding, add to hidden set
    hiddenMarkers.add(markerId);
  }
  
  // Save updated hidden markers
  await saveHiddenMarkers();
}

/**
 * Set a category's visibility
 * @param category - The category to set visibility for
 * @param visible - Whether the category should be visible
 */
export async function setCategoryVisibility(category: string, visible: boolean): Promise<void> {
  await initVisibilityMiddleware();
  
  if (visible) {
    // If making visible, just remove from hidden set
    hiddenCategories.delete(category);
  } else {
    // If hiding, add to hidden set
    hiddenCategories.add(category);
  }
  
  // Save updated hidden categories
  await saveHiddenCategories();
}

/**
 * Get all hidden markers
 * @returns Set of hidden marker IDs
 */
export function getHiddenMarkers(): Set<string> {
  return new Set(hiddenMarkers);
}

/**
 * Get all hidden categories
 * @returns Set of hidden category names
 */
export function getHiddenCategories(): Set<string> {
  return new Set(hiddenCategories);
}

/**
 * Save hidden markers to persistent storage
 */
async function saveHiddenMarkers(): Promise<void> {
  try {
    await visibilityStore.setItem(HIDDEN_MARKERS_KEY, Array.from(hiddenMarkers));
  } catch (error) {
    console.error('Failed to save hidden markers:', error);
  }
}

/**
 * Save hidden categories to persistent storage
 */
async function saveHiddenCategories(): Promise<void> {
  try {
    await visibilityStore.setItem(HIDDEN_CATEGORIES_KEY, Array.from(hiddenCategories));
  } catch (error) {
    console.error('Failed to save hidden categories:', error);
  }
}

/**
 * Reset all visibility settings
 */
export async function resetVisibility(): Promise<void> {
  await initVisibilityMiddleware();
  
  hiddenMarkers.clear();
  hiddenCategories.clear();
  
  await Promise.all([
    saveHiddenMarkers(),
    saveHiddenCategories()
  ]);
}

/**
 * Get the number of hidden items
 * @returns The total number of hidden markers and categories
 */
export function getHiddenCount(): { markers: number, categories: number } {
  return {
    markers: hiddenMarkers.size,
    categories: hiddenCategories.size
  };
}

// Function to save visibility state to localStorage
function saveVisibilityState() {
  try {
    localStorage.setItem(
      'soulmap_hidden_markers',
      JSON.stringify(Array.from(hiddenMarkers))
    );
    localStorage.setItem(
      'soulmap_hidden_categories',
      JSON.stringify(Array.from(hiddenCategories))
    );
  } catch (error) {
    console.error('Error saving visibility state:', error);
  }
}

// Function to load visibility state from localStorage
function loadVisibilityState() {
  try {
    const markersJson = localStorage.getItem('soulmap_hidden_markers');
    const categoriesJson = localStorage.getItem('soulmap_hidden_categories');

    if (markersJson) {
      hiddenMarkers = new Set(JSON.parse(markersJson));
    }

    if (categoriesJson) {
      hiddenCategories = new Set(JSON.parse(categoriesJson));
    }
  } catch (error) {
    console.error('Error loading visibility state:', error);
    hiddenMarkers = new Set();
    hiddenCategories = new Set();
  }
}

// Make marker visible and update state
export async function showMarker(markerId: string): Promise<void> {
  if (hiddenMarkers.has(markerId)) {
    hiddenMarkers.delete(markerId);
    saveVisibilityState();
  }
  return setMarkerVisibility(markerId, true);
}

// Add a new helper function to force marker redraw
export function forceMarkerRedraw(markerId: string): void {
  // This will be called after visibility changes to ensure immediate visual update
  const event = new CustomEvent('forceMarkerRedraw', { 
    detail: { markerId }
  });
  document.dispatchEvent(event);
}
