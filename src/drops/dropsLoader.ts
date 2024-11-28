import type { ItemDrop, DropsIndex, Location } from '../types';
import localforage from 'localforage';

const DROPS_CACHE_KEY = 'soulmap_drops_cache';

// Initialize localforage instance for drops
const dropsStore = localforage.createInstance({
  name: 'soulmap-drops',
  description: 'Cache for item drops data',
  driver: [
    localforage.INDEXEDDB,
    localforage.WEBSQL,
    localforage.LOCALSTORAGE
  ],
  storeName: 'drops' // Add explicit store name
});

// Validate required fields for an ItemDrop
function isValidDrop(drop: any): drop is ItemDrop {
  return (
    typeof drop === 'object' &&
    typeof drop.name === 'string' &&
    typeof drop.description === 'string' &&
    typeof drop.type === 'string' &&
    typeof drop.rarity === 'string' &&
    Array.isArray(drop.sources) &&
    drop.sources.every((source: any) => typeof source === 'string')
  );
}

export async function loadDrops(): Promise<DropsIndex> {
  try {
    await dropsStore.ready(); // Ensure store is ready

    // Try to load cached data first
    const cachedData = await dropsStore.getItem<{version: string, data: DropsIndex}>(DROPS_CACHE_KEY);
    const versionModule = await import('../mapversion.yml');
    const currentVersion = versionModule.default.game_version;

    // Use cached data if versions match
    if (cachedData && cachedData.version === currentVersion) {
      console.log('Using cached drops data');
      return cachedData.data;
    }

    // If no cache or version mismatch, load from files
    const drops: DropsIndex = {};
    const importDrops = import.meta.glob('./**/*.y?(a)ml');
    
    await Promise.all(
      Object.entries(importDrops).map(async ([path, importFn]) => {
        try {
          const module = await importFn() as { default: any };
          const category = path.split('/')[1];
          
          if (!isValidDrop(module.default)) {
            console.error(`Invalid drop file format: ${path}`);
            return;
          }
          
          if (!drops[category]) {
            drops[category] = [];
          }
          
          drops[category].push(module.default);
        } catch (error) {
          console.error(`Error loading drop file: ${path}`, error);
        }
      })
    );

    // Cache the new data
    await dropsStore.setItem(DROPS_CACHE_KEY, {
      version: currentVersion,
      data: drops
    });
    
    return drops;
  } catch (error) {
    console.error('Error loading drops:', error);
    throw error;
  }
}

export async function clearDropsCache(): Promise<void> {
  try {
    await dropsStore.removeItem(DROPS_CACHE_KEY);
  } catch (error) {
    console.error('Error clearing drops cache:', error);
  }
}

// Helper function to find locations that may drop an item, now with fuzzy matching
export function findDropLocations(item: ItemDrop, locations: Location[]): Location[] {
  const sources = new Set(item.sources.map(s => s.toLowerCase()));
  
  return locations.filter(location => {
    const locationName = location.name.toLowerCase();
    return Array.from(sources).some(source => {
      // Check for exact match first
      if (locationName === source) return true;
      // Then check for partial match
      return locationName.includes(source) || source.includes(locationName);
    });
  });
}