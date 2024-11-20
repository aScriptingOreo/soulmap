// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';

function generateLocationHash(name: string): string {
  // Replace spaces and special characters with dashes, convert to lowercase
  return name.toLowerCase()
             .replace(/[^a-z0-9]+/g, '-')
             .replace(/(^-|-$)/g, '');
}

function decodeLocationHash(hash: string, locations: (Location & { type: string })[]): Location & { type: string } | undefined {
  return locations.find(l => generateLocationHash(l.name) === hash);
}

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
    minZoom: -2,
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
      coordinatesArray.forEach(([x, y], index) => {
        // Use either Font Awesome icon or custom SVG icon
        let icon: L.Icon | L.DivIcon;
        if (location.icon && location.icon.startsWith('fa-')) {
          const sizeMultiplier = location.iconSize || 1;
          icon = L.divIcon({
            className: 'custom-location-icon',
            html: `<i class="${location.icon}" style="font-size: ${iconSize[0] * sizeMultiplier}px; color: ${location.iconColor || '#FFFFFF'}; text-shadow: 2px 2px 4px black;"></i>`, // Remove the marker-number span
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

        // Add data attributes for visibility tracking and indexing
        marker.getElement()?.setAttribute('data-location', location.name);
        if (coordinatesArray.length > 1) {
            marker.getElement()?.setAttribute('data-index', index.toString());
        }

        // Bind tooltip with adjusted offset
        const tooltipContent = coordinatesArray.length > 1 ? 
          `${location.name} #${index + 1}` : 
          location.name;
        
        marker.bindTooltip(tooltipContent, { 
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

          // Get marker index for multi-location items
          const isMultiLocation = coordinatesArray.length > 1;
          const locationHash = generateLocationHash(location.name);
          const urlParams = isMultiLocation ? 
            `?loc=${locationHash}&index=${index}` : 
            `?loc=${locationHash}`;

          // Update URL with location hash and index if applicable
          window.history.replaceState({}, '', urlParams);
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

    // Handle URL parameters after map is initialized
    const urlParams = new URLSearchParams(window.location.search);
    const locationParam = urlParams.get('loc');
    const indexParam = urlParams.get('index');

    if (locationParam) {
        const location = decodeLocationHash(locationParam, locations);
        
        if (location) {
            const coords = Array.isArray(location.coordinates[0]) 
                ? (indexParam ? 
                    location.coordinates[parseInt(indexParam)] : 
                    location.coordinates[0]) as [number, number]
                : location.coordinates as [number, number];
                
            // Find and trigger the marker
            const marker = markers.find(m => {
                const pos = m.getLatLng();
                return pos.lat === coords[1] && pos.lng === coords[0];
            });
            
            if (marker) {
                map.setView([coords[1], coords[0]], map.getZoom());
                marker.fire('click');
            }
        }
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