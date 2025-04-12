import defaultsFile from '../locations/defaults.yml';

// Flag to track first load
const FIRST_LOAD_KEY = 'soulmap_first_load_completed';

// Interface for defaults configuration
interface DefaultsConfig {
  hiddenCategories?: string[];
  hiddenMarkers?: string[];
}

// Get structured defaults configuration
export function getDefaultsConfig(): DefaultsConfig {
  try {
    // Cast the imported yml file to our interface
    return defaultsFile as DefaultsConfig;
  } catch (error) {
    console.error('Error loading defaults configuration:', error);
    return { hiddenCategories: [], hiddenMarkers: [] };
  }
}

// Check if this is the first load of the application
export function isFirstLoad(): boolean {
  try {
    return localStorage.getItem(FIRST_LOAD_KEY) === null;
  } catch (error) {
    // If localStorage access fails, assume it's not first load for safety
    console.warn('Error accessing localStorage for first load check:', error);
    return false;
  }
}

// Mark first load as completed
export function markFirstLoadCompleted(): void {
  try {
    localStorage.setItem(FIRST_LOAD_KEY, 'true');
  } catch (error) {
    console.error('Error marking first load as completed:', error);
  }
}
