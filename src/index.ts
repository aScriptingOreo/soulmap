// src/index.ts
import { loadLocations } from './loader';
import { initializeMap } from './map';

// Main function to orchestrate loading and map initialization
async function main() {
  const urlParams = new URLSearchParams(window.location.search);
  const debug = urlParams.get('debug') === 'true';
  const locations = await loadLocations();
  if (locations.length > 0) {
    initializeMap(locations, debug);
  } else {
    console.error("No locations loaded. Map initialization aborted.");
  }
}

main();