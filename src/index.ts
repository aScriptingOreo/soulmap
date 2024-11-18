// src/index.ts
import { loadLocations } from './loader';
import { initializeMap } from './map';

// Main function to orchestrate loading and map initialization
async function main() {
  const locations = await loadLocations();
  if (locations.length > 0) {
    initializeMap(locations);
  } else {
    console.error("No locations loaded. Map initialization aborted.");
  }
}

main();