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
          }
        }
        const marker = L.marker([y, x], { icon }).addTo(map);
        // Bind tooltip on hover
        marker.bindTooltip(location.name, { permanent: false, direction: 'top' });

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

        // Referências aos elementos do dropdown
        const imageDropdown = document.getElementById('image-dropdown')!;
        const dropdownImage = document.getElementById('dropdown-image') as HTMLImageElement;

        // Para cada marcador, modifique o evento de clique
        marker.on('click', () => {
          // Verifica se a localização tem uma imagem
          if (location.imgUrl) {
            // Exibe a imagem no dropdown
            dropdownImage.src = location.imgUrl;
            imageDropdown.style.display = 'block';
          } else {
            // Se não houver imagem, oculta o dropdown
            imageDropdown.style.display = 'none';
            dropdownImage.src = '';
          }
          // Resto do código...
        });

        // Remove selected class when clicking outside the marker
        map.on('click', (e) => {
          if (!marker.getElement()?.contains(e.originalEvent.target as Node)) {
            document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
              el.classList.remove('selected');
            });
            imageDropdown.style.display = 'none';
            dropdownImage.src = '';
          }
        });
        // Keep marker centered on zoom
        map.on('zoomend', () => {
          marker.setLatLng([y, x]);
        });

        // Instead, add this to your marker click handler:
        marker.on('click', () => {
          const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
          const titleEl = sidebar.querySelector('.location-title') as HTMLElement;
          const descEl = sidebar.querySelector('.location-description') as HTMLElement;
          const coordEl = sidebar.querySelector('.coordinates-display') as HTMLElement;
          const imgEl = sidebar.querySelector('#sidebar-image') as HTMLImageElement;
          const imageModal = document.querySelector('#image-modal') as HTMLElement;
          const modalImage = document.querySelector('#modal-image') as HTMLImageElement;
          const modalTitle = document.querySelector('.modal-title') as HTMLElement;
          const modalDescription = document.querySelector('.modal-description') as HTMLElement;
          const closeButton = document.querySelector('.close-button') as HTMLElement;

          // Update content
          titleEl.textContent = location.name;
          descEl.textContent = location.description || 'No description available';
          coordEl.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;

          // Handle image
          if (location.imgUrl) {
            imgEl.src = location.imgUrl;
            imgEl.style.display = 'block';

            // Add click handler for the image
            imgEl.onclick = () => {
              modalImage.src = location.imgUrl;
              modalTitle.textContent = location.name;
              modalDescription.textContent = location.description || 'No description available';
              imageModal.style.display = 'flex';
            };

            // Close modal when clicking close button
            closeButton.onclick = () => {
              imageModal.style.display = 'none';
            };

            // Close modal when clicking outside
            imageModal.onclick = (e) => {
              if (e.target === imageModal) {
                imageModal.style.display = 'none';
              }
            };
          } else {
            imgEl.style.display = 'none';
            imgEl.src = '';
          }

          // Show sidebar and handle marker selection
          sidebar.classList.add('active');
        });

        // Add click handler to map to close sidebar when clicking outside
        map.on('click', (e) => {
          if (!marker.getElement()?.contains(e.originalEvent.target as Node)) {
            const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
            sidebar.classList.remove('active');
            document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
              el.classList.remove('selected');
            });
          }
        });
      });
    });

// Display coordinates on map click (for any location)
map.on('click', (e) => {
  const coordinates = e.latlng;
  const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
  const coordEl = sidebar.querySelector('.coordinates-display') as HTMLElement;
  const titleEl = sidebar.querySelector('.location-title') as HTMLElement;
  const descEl = sidebar.querySelector('.location-description') as HTMLElement;

  // Update coordinates display
  coordEl.textContent = `X: ${Math.round(coordinates.lng)}, Y: ${Math.round(coordinates.lat)}`;
  
  // Clear other fields when clicking empty space
  if (!e.originalEvent.target.classList.contains('custom-location-icon')) {
    titleEl.textContent = 'Map Location';
    descEl.textContent = 'Click on a marker to see location details';
  }
});

map.on('click', (e) => {
  if (!e.originalEvent.target.classList.contains('custom-location-icon')) {
    const sidebar = document.querySelector('.right-sidebar') as HTMLElement;
    const titleEl = sidebar.querySelector('.location-title') as HTMLElement;
    const descEl = sidebar.querySelector('.location-description') as HTMLElement;
    const imgEl = sidebar.querySelector('#sidebar-image') as HTMLImageElement;

    titleEl.textContent = 'Map Location';
    descEl.textContent = 'Click on a marker to see location details';
    imgEl.style.display = 'none';
    imgEl.src = '';
  }
});
  }; // Close img.onload

  img.onerror = () => {
    console.error("Failed to load the image 'midrath.jpg'. Check the path and ensure it exists in 'res/'.");
  };
} // Close initializeMap

// Add click handler for the sidebar image
const sidebarImage = document.querySelector('#sidebar-image') as HTMLImageElement;
const imageModal = document.querySelector('#image-modal') as HTMLElement;
const modalImage = document.querySelector('#modal-image') as HTMLImageElement;
const modalTitle = document.querySelector('.modal-title') as HTMLElement;
const modalDescription = document.querySelector('.modal-description') as HTMLElement;
const closeButton = document.querySelector('.close-button') as HTMLElement;

// Function to close modal
const closeModal = () => {
  imageModal.style.display = 'none';
};

// Open modal when clicking sidebar image
sidebarImage.addEventListener('click', () => {
  if (location.imgUrl) {
    modalImage.src = location.imgUrl;
    modalTitle.textContent = location.name;
    modalDescription.textContent = location.description || 'No description available';
    imageModal.style.display = 'flex';
  }
});

// Close modal when clicking close button
closeButton.addEventListener('click', closeModal);

// Close modal when clicking outside the image
imageModal.addEventListener('click', (e) => {
  if (e.target === imageModal) {
    closeModal();
  }
});

// Close modal with ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});