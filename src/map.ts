// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';

export async function initializeMap(locations: (Location & { type: string })[], debug: boolean = false): Promise<void> {
  // Determine the default zoom level and icon size based on device type
  const deviceType = getDeviceType();
  let defaultZoom: number;
  let iconSize: [number, number];
  switch (deviceType) {
    case 'desktop':
      defaultZoom = -2;
      iconSize = [50, 82];
      break;
    case 'tablet':
      defaultZoom = -3;
      iconSize = [50, 82];
      break;
    case 'phone':
      defaultZoom = -4;
      iconSize = [50, 82];
      break;
  }

  // Create the map with the default zoom level
  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -5,
    zoom: defaultZoom
  });

  // Load the image to get its dimensions
  const img = new Image();
  img.src = '/midrath.jpg';
  
  const markers: L.Marker[] = [];

  img.onload = () => {
    const bounds = [[0, 0], [img.height, img.width]];
    L.imageOverlay('/midrath.jpg', bounds).addTo(map);
    map.fitBounds(bounds);

    // Create markers for each location
    locations.forEach((location) => {
      const [x, y] = Array.isArray(location.coordinates[0]) 
        ? location.coordinates[0] as [number, number]
        : location.coordinates as [number, number];

      const icon = L.divIcon({
        className: 'custom-location-icon',
        html: `<i class="${location.icon}" style="font-size: ${location.iconSize || 1}em;"></i>`,
        iconSize: [30, 30]
      });

      const marker = L.marker([y, x], { icon }).addTo(map);
      markers.push(marker);

      // Bind tooltip
      marker.bindTooltip(location.name, { permanent: false, direction: 'top' });
    });

    // Initialize sidebar with markers
    const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
    const sidebar = new Sidebar({
      element: sidebarElement,
      locations,
      map,
      markers
    });

    // Initialize search functionality
    initializeSearch(locations, map, markers);

    if (debug) {
      map.on('click', (e) => {
        console.log(`Clicked coordinates: ${Math.round(e.latlng.lng)}, ${Math.round(e.latlng.lat)}`);
      });
    }
  };

  img.onerror = () => {
    console.error("Failed to load the image 'midrath.jpg'. Check the path and ensure it exists in 'res/'.");
  };
}