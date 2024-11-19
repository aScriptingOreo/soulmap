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

  // Define custom icons for different types
  const icons = {
    location: L.icon({
      iconUrl: '/SF_location_marker.svg',
      iconSize: iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
      popupAnchor: [0, -iconSize[1] / 2],
      className: 'custom-location-icon'
    }),
    dungeon: L.icon({
      iconUrl: '/SF_dungeon_entrance.svg',
      iconSize: [iconSize[0] * 1.5, iconSize[1] * 1.5],
      iconAnchor: [iconSize[0] * 1.5 / 2, iconSize[1] * 1.5 / 2],
      popupAnchor: [0, -iconSize[1] * 1.5 / 2],
      className: 'custom-location-icon'
    }),
    loot: L.icon({
      iconUrl: '/SF_loot.svg',
      iconSize: iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
      popupAnchor: [0, -iconSize[1] / 2],
      className: 'custom-location-icon'
    }),
    unknown: L.icon({
      iconUrl: '/question_mark.svg',
      iconSize: iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
      popupAnchor: [0, -iconSize[1] / 2],
      className: 'custom-location-icon'
    })
  };

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

    // Initialize sidebar first
    const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
    const sidebar = new Sidebar({
      element: sidebarElement,
      locations,
      map,
      markers
    });

    // Create markers for each location
    locations.forEach((location) => {
      // Handle multiple coordinates
      const coordinatesArray = Array.isArray(location.coordinates[0]) 
        ? location.coordinates as [number, number][]
        : [location.coordinates] as [number, number][];

      // Create a marker for each coordinate
      coordinatesArray.forEach(([x, y]) => {
        // Use either Font Awesome icon or custom SVG icon
        let icon: L.Icon | L.DivIcon;
        if (location.icon && location.icon.startsWith('fa-')) {
          const sizeMultiplier = location.iconSize || 1;
          icon = L.divIcon({
            className: 'custom-location-icon',
            html: `<i class="${location.icon}" style="font-size: ${iconSize[0] * sizeMultiplier}px; color: ${location.iconColor || '#FFFFFF'}; text-shadow: 2px 2px 4px black;"></i>`,
            iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
            iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2]
          });
        } else {
          const sizeMultiplier = location.iconSize || 1;
          icon = L.icon({
            iconUrl: `${location.icon}.svg`,
            iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
            iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2],
            className: 'custom-location-icon'
          });
        }

        // Create and add marker to map
        const marker = L.marker([y, x], { icon }).addTo(map);
        markers.push(marker);

        // Bind tooltip with adjusted offset
        marker.bindTooltip(location.name, { 
          permanent: false, 
          direction: 'top',
          offset: [0, -30], // Move tooltip 30 pixels up
          className: 'leaflet-tooltip' // Ensure our custom styles are applied
        });

        // Add click handler for marker
        marker.on('click', () => {
          // Update sidebar content
          sidebar.updateContent(location, x, y);

          // Handle marker highlight
          document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
            el.classList.remove('selected');
          });
          marker.getElement()?.classList.add('selected');
        });
      });
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

  // Add map click handler for coordinates
  map.on('click', (e) => {
    const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
    const titleEl = sidebar.querySelector('.location-title') as HTMLElement;
    const descEl = sidebar.querySelector('.location-description') as HTMLElement;
    const coordEl = sidebar.querySelector('.coordinates-display') as HTMLElement;
    const imgEl = sidebar.querySelector('#sidebar-image') as HTMLImageElement;

    // Update coordinates display
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    titleEl.textContent = 'Map Location';
    descEl.textContent = 'Click on a marker to see location details';
    coordEl.textContent = `[${x}, ${y}]`; // Changed format to match YAML
    
    // Clear image if any
    imgEl.style.display = 'none';
    imgEl.src = '';
  });

  // Add map click handler for coordinates
  map.on('click', (e) => {
    const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
    const titleEl = sidebar.querySelector('.location-title') as HTMLElement;
    const descEl = sidebar.querySelector('.location-description') as HTMLElement;
    const coordEl = sidebar.querySelector('.coordinates-display') as HTMLElement;
    const imgEl = sidebar.querySelector('#sidebar-image') as HTMLImageElement;

    // Update coordinates display
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    titleEl.textContent = 'Map Location';
    descEl.textContent = 'Click on a marker to see location details';
    coordEl.textContent = `[${x}, ${y}]`; // Updated to YAML format
    
    // Clear image if any
    imgEl.style.display = 'none';
    imgEl.src = '';

    // Clear any selected markers
    document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
      el.classList.remove('selected');
    });

    if (debug) {
      console.log(`Clicked coordinates: [${x}, ${y}]`); // Updated debug log format too
    }
  });
}