// src/loader.ts
import type { Location } from './types';

// Function to load all location YAML files
export async function loadLocations(): Promise<Location[]> {
  const importLocations = import.meta.glob('./locations/*.y?(a)ml');
  const locationPromises: Promise<Location>[] = [];

  for (const path in importLocations) {
    console.log(`Importing: ${path}`); // Log each path
    locationPromises.push(
      importLocations[path]().then((module) => {
        const loadedModule = module as { default: Location };
        console.log(`Loaded module from ${path}:`, loadedModule.default);
        return loadedModule.default;
      })
    );
  }

  try {
    const locations = await Promise.all(locationPromises);
    console.log("All locations loaded:", locations);
    return locations;
  } catch (error) {
    console.error("Error loading location files:", error);
    return [];
  }
}