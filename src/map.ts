// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';

// Function to initialize the map and add locations
export async function initializeMap(locations: (Location & { type: string })[], debug: boolean = false): Promise<void> {
  // Determine the default zoom level and icon size based on device type
  const deviceType = getDeviceType();
  let defaultZoom: number;
  let iconSize: [number, number];

  switch (deviceType) {
    case 'desktop':
      defaultZoom = -2;
      iconSize = [50, 82]; // Original size
      break;
    case 'tablet':
      defaultZoom = -3;
      iconSize = [50, 82]; // Twice the original size
      break;
    case 'phone':
      defaultZoom = -4;
      iconSize = [50, 82]; // Twice the original size
      break;
    default:
      defaultZoom = -5;
      iconSize = [50, 82]; // Original size
  }

  // Create the map with the default zoom level
  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -5,
    zoom: defaultZoom
  });

  // Load the image to get its dimensions
  const img = new Image();
  img.src = '/midrath.jpg'; // Path to the image in res/
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    console.log(`Image loaded: width=${w}, height=${h}`);

    // Define image bounds using the actual image size
    const bounds: L.LatLngBoundsExpression = [[0, 0], [h, w]];

    // Add the image overlay
    L.imageOverlay('/midrath.jpg', bounds).addTo(map);
    map.fitBounds(bounds);

    // Define custom icons for different types
    const icons = {
      location: L.icon({
        iconUrl: '/SF_location_marker.svg', // Served from publicDir (res/)
        iconSize: iconSize, // Adjusted size based on device type
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2], // Center of the icon
        popupAnchor: [0, -iconSize[1] / 2], // Adjusted popup position
        className: 'custom-location-icon' // Custom class for additional styling
      }),
      dungeon: L.icon({
        iconUrl: '/SF_dungeon_entrance.svg', // Served from publicDir (res/)
        iconSize: [iconSize[0] * 1.5, iconSize[1] * 1.5], // 1.5 times the original size
        iconAnchor: [iconSize[0] * 1.5 / 2, iconSize[1] * 1.5 / 2], // Center of the icon
        popupAnchor: [0, -iconSize[1] * 1.5 / 2], // Adjusted popup position
        className: 'custom-location-icon' // Custom class for additional styling
      }),
      loot: L.icon({
        iconUrl: '/SF_loot.svg', // Served from publicDir (res/)
        iconSize: iconSize, // Adjusted size based on device type
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2], // Center of the icon
        popupAnchor: [0, -iconSize[1] / 2], // Adjusted popup position
        className: 'custom-location-icon' // Custom class for additional styling
      }),
      unknown: L.icon({
        iconUrl: '/question_mark.svg', // Served from publicDir (res/)
        iconSize: iconSize, // Adjusted size based on device type
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2], // Center of the icon
        popupAnchor: [0, -iconSize[1] / 2], // Adjusted popup position
        className: 'custom-location-icon' // Custom class for additional styling
      })
    };

    // Add each location as a marker
    locations.forEach((location) => {
      const iconType = (['location', 'dungeon', 'loot', 'unknown'].includes(location.type) ? location.type : 'unknown') as 'location' | 'dungeon' | 'loot' | 'unknown'; // Use type from directory or 'unknown'
      const coordinates = Array.isArray(location.coordinates[0]) ? location.coordinates as [number, number][] : [location.coordinates as [number, number]];

      coordinates.forEach(([x, y]) => {
        console.log(`Adding marker: ${location.name} at (${x}, ${y}) with type ${iconType}`);

        // Use Font Awesome icon if specified
        let icon: L.Icon | L.DivIcon = icons[iconType];
        if (location.icon) {
          const sizeMultiplier = location.iconSize || 1; // Default to 1 if not specified
          if (location.icon.startsWith('fa-')) {
            const iconHtml = `<i class="${location.icon}" style="font-size: ${iconSize[0] * sizeMultiplier}px; color: white; text-shadow: 2px 2px 4px black;"></i>`;
            icon = L.divIcon({
              html: iconHtml,
              className: 'custom-location-icon',
              iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
              iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2],
              popupAnchor: [0, -iconSize[1] * sizeMultiplier / 2]
            });
          } else {
            icon = L.icon({
              iconUrl: location.icon,
              iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
              iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2],
              popupAnchor: [0, -iconSize[1] * sizeMultiplier / 2],
              className: 'custom-location-icon'
            });
          }
        }

        const marker = L.marker([y, x], { icon }).addTo(map);

        // Bind tooltip on hover
        marker.bindTooltip(location.name, { permanent: false, direction: 'top' });

        // Bind popup on click
        marker.bindPopup(`<strong>${location.name}</strong><br>${location.description}`);

        // Add click event to toggle the selected class
        marker.on('click', () => {
          document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
            el.classList.remove('selected');
          });
          const iconElement = marker.getElement();
          if (iconElement) {
            iconElement.classList.add('selected');
          }
        });

        // Remove selected class when clicking outside the marker
        map.on('click', (e) => {
          if (!marker.getElement()?.contains(e.originalEvent.target as Node)) {
            document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
              el.classList.remove('selected');
            });
          }
        });

        // Keep marker centered on zoom
        map.on('zoomend', () => {
          marker.setLatLng([y, x]);
        });
      });
    });

    // Display cursor coordinates on click
    const cursorPosition = document.createElement('div');
    cursorPosition.id = 'cursor-position';
    document.body.appendChild(cursorPosition);

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      cursorPosition.innerText = `X: ${Math.round(lng)}, Y: ${Math.round(lat)}`;
    });
  };

  img.onerror = () => {
    console.error("Failed to load the image 'midrath.jpg'. Check the path and ensure it exists in 'res/'.");
  };
}