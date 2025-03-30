/**
 * Visibility Middleware Service
 * Only stores markers that are hidden (false visibility)
 * All markers are considered visible by default
 * Uses localforage for persistent storage
 */
import localforage from 'localforage';

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
export function initVisibilityMiddleware(): Promise<void> {
  if (isInitialized) return Promise.resolve();
  
  if (!initializationPromise) {
    initializationPromise = initializeStore();
  }
  
  return initializationPromise;
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
