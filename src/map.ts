// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';
import { initializeGrid } from './gridLoader';

function generateLocationHash(name: string): string {
  // Replace spaces and special characters with dashes, convert to lowercase
  return name.toLowerCase()
             .replace(/[^a-z0-9]+/g, '-')
             .replace(/(^-|-$)/g, '');
}

function decodeLocationHash(hash: string, locations: (Location & { type: string })[]): Location & { type: string } | undefined {
  return locations.find(l => generateLocationHash(l.name) === hash);
}

function updateMetaTags(location: Location & { type: string }, coords: [number, number]) {
    // Update title
    document.title = `${location.name} - Soulmap`;

    // Update meta description
    const description = location.description || 'No description available';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);

    // Update Open Graph meta tags
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);

    // Set image based on location type
    let imageUrl;
    if (location.imgUrl) {
        imageUrl = location.imgUrl;
    } else if (location.icon?.startsWith('fa-')) {
        // Generate Font Awesome icon image URL
        const iconClass = location.icon.replace('fa-solid ', '');
        imageUrl = `https://fa-icons.com/${iconClass}.svg`;
    } else if (location.icon) {
        // Use self-hosted icon
        const baseUrl = window.location.origin;
        imageUrl = `${baseUrl}${location.icon}.svg`;
    }

    if (imageUrl) {
        document.querySelector('meta[property="og:image"]')?.setAttribute('content', imageUrl);
        document.querySelector('meta[property="twitter:image"]')?.setAttribute('content', imageUrl);
    }

    // Update Twitter card meta tags
    document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);
}

export async function initializeMap(locations: (Location & { type: string })[], debug: boolean = false): Promise<void> {
    const deviceType = getDeviceType();
    const defaultZoom = deviceType === 'mobile' ? -1 : 0;
    const iconSize = deviceType === 'mobile' ? [20, 20] : [30, 30];

    // Create the map with proper CRS settings
      const map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 2,
        zoom: defaultZoom,
        zoomDelta: 0.5,
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 120,
        maxBounds: [
            [0, 0],
            [196 * 512, 13 * 512]
        ]
    });

    // Initialize grid before markers
    await initializeGrid(map);

    // Initialize locations and markers
    const markers: L.Marker[] = [];

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

              // Update meta tags for social sharing
              updateMetaTags(location, [x, y]);
          });
        });
    });

    // Initialize search functionality
    initializeSearch(locations, map, markers);

    // Initialize sidebar after markers are created
    const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
    const sidebar = new Sidebar({
        element: sidebarElement,
        locations,
        map,
        markers
    });

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

    // After map initialization
    const devOverlay = new DevelopmentOverlay(map);
    devOverlay.createOverlay([
        [2322, 492],
        [1651, 1115],
        [2645, 2011],
        [3987, 1230]
    ]);
}