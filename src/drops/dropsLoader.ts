import type { ItemDrop, DropsIndex, Location } from '../types';

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
  const drops: DropsIndex = {};
  const importDrops = import.meta.glob('./**/*.y?(a)ml');
  
  await Promise.all(
    Object.entries(importDrops).map(async ([path, importFn]) => {
      try {
        const module = await importFn() as { default: any };
        const category = path.split('/')[1]; // general, weapons, etc.
        
        // Validate the drop data before adding
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
  
  return drops;
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