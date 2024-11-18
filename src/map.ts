// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';

// Function to initialize the map and add locations
export function initializeMap(locations: Location[]): void {
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

    // Define custom icon using the SVG with increased size and shadow
    const locationIcon = L.icon({
      iconUrl: '/SF_location_marker.svg', // Served from publicDir (res/)
      iconSize: iconSize, // Adjusted size based on device type
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2], // Center of the icon
      popupAnchor: [0, -iconSize[1] / 2], // Adjusted popup position
      className: 'custom-location-icon' // Custom class for additional styling
    });

    // Add each location as a marker
    locations.forEach((location) => {
      const [x, y] = location.coordinates;
      console.log(`Adding marker: ${location.name} at (${x}, ${y})`);
      const marker = L.marker([y, x], { icon: locationIcon }).addTo(map);

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
        if (!marker.getElement()?.contains(e.originalEvent.target)) {
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
  };

  img.onerror = () => {
    console.error("Failed to load the image 'midrath.jpg'. Check the path and ensure it exists in 'res/'.");
  };
}