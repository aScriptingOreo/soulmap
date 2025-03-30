import type { Location } from './types';
import * as L from 'leaflet';
import { getRelativeDirection } from './utils';
import { setMarkerVisibility } from './services/visibilityMiddleware';

interface SearchResult {
  location: Location & { type: string };
  score: number;
}

export async function initializeSearch(locations: (Location & { type: string })[], map: L.Map, markers: L.Marker[]) {
  const searchContainer = document.querySelector('.search-container') as HTMLElement;
  const searchOverlay = document.querySelector('.search-overlay') as HTMLElement;
  
  searchContainer.innerHTML = `
    <input type="text" id="location-search" placeholder="Press Ctrl + Space to search...">
    <div class="search-results"></div>
  `;

  const searchInput = document.getElementById('location-search') as HTMLInputElement;
  const resultsContainer = document.querySelector('.search-results') as HTMLDivElement;
  let selectedIndex = -1;

  async function searchAll(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const normalizedQuery = query.toLowerCase();
    const terms = normalizedQuery.split(' ').filter(term => term.length > 0);

    // Search locations only
    locations.forEach(location => {
      let score = 0;
      const name = location.name.toLowerCase();
      const description = (location.description || '').toLowerCase();

      terms.forEach(term => {
        if (name === term) score += 100;
        if (name.includes(term)) score += 75;
        if (name.split(' ').some(word => word.startsWith(term))) score += 60;
        if (description === term) score += 50;
        if (description.includes(term)) score += 25;
        if (description.split(' ').some(word => word.startsWith(term))) score += 20;
      });

      if (score > 0) {
        results.push({ location, score });
      }
    });

    return results.sort((a, b) => b.score - a.score);
  }

  function updateResults(results: SearchResult[]) {
    if (results.length > 0) {
      resultsContainer.innerHTML = results
        .slice(0, 8)
        .map((result, index) => {
          return renderLocationResult(result.location, index, selectedIndex, locations);
        })
        .join('');
    } else {
      resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
    }
    resultsContainer.style.display = 'block';
  }

  function selectLocation(location: Location & { type: string }, coordIndex?: number) {
    const isMultiLocation = Array.isArray(location.coordinates[0]);
    let coords: [number, number];
    
    if (isMultiLocation) {
      coords = coordIndex !== undefined && coordIndex >= 0 
        ? (location.coordinates as [number, number][])[coordIndex]
        : (location.coordinates as [number, number][])[0];
    } else {
      coords = location.coordinates as [number, number];
    }

    const currentCenter = map.getCenter();
    const distance = map.distance(
        [currentCenter.lat, currentCenter.lng],
        [coords[1], coords[0]]
    );

    const targetZoom = calculateOptimalZoom(distance);
    const duration = calculateAnimationDuration(distance);

    map.once("movestart", () => {
        document
            .querySelector(".leaflet-marker-pane")
            ?.classList.add("leaflet-zoom-hide");
    });

    map.once("moveend", () => {
        document
            .querySelector(".leaflet-marker-pane")
            ?.classList.remove("leaflet-zoom-hide");
    });

    map.flyTo([coords[1], coords[0]], targetZoom, {
        duration: duration,
        easeLinearity: 0.25,
        noMoveStart: true,
        animate: true,
        keepPixelPosition: true,
        updateDragInertia: false,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 3000,
        animateZoom: true,
    });

    const marker = markers.find(m => {
        const pos = m.getLatLng();
        if (pos.lat === coords[1] && pos.lng === coords[0]) {
          if (isMultiLocation && coordIndex !== undefined) {
            const tooltipContent = m.getTooltip()?.getContent() as string;
            return tooltipContent === `${location.name} #${coordIndex + 1}`;
          }
          return true;
        }
        return false;
    });

    if (marker) {
        const markerId = isMultiLocation && coordIndex !== undefined
            ? `${location.name}-${coordIndex}`
            : location.name;
        
        setMarkerVisibility(markerId, true).then(() => {
            const markerElement = marker.getElement();
            if (markerElement) {
                markerElement.style.display = "";
                if ((marker as any).uncertaintyCircle) {
                    (marker as any).uncertaintyCircle.setStyle({
                        opacity: 0.6,
                        fillOpacity: 0.2
                    });
                }
            }
            
            marker.setLatLng(marker.getLatLng());
        });

        document.querySelectorAll('.custom-location-icon.selected').forEach(el => {
            el.classList.remove('selected');
        });
        marker.getElement()?.classList.add('selected');

        setTimeout(() => {
            marker.fire('click');
        }, duration * 1000);

        const locationHash = generateLocationHash(location.name);
        const urlParams = isMultiLocation && coordIndex !== undefined
            ? `?loc=${locationHash}&index=${coordIndex}`
            : `?loc=${locationHash}`;
        window.history.replaceState({}, '', urlParams);
    }

    closeSearch();
  }

  function selectResult(result: SearchResult, clickedElement?: HTMLElement) {
    const tabSystem = document.querySelector('.tab-system');
    const locationsTab = tabSystem?.querySelector('.sidebar-tab:nth-child(1)') as HTMLElement;
    if (locationsTab) {
        locationsTab.click();
    }

    let coordIndex: number | undefined = undefined;
    
    if (clickedElement) {
        const indexAttr = clickedElement.getAttribute('data-coord-index');
        if (indexAttr) {
            coordIndex = parseInt(indexAttr);
        }
    } else {
        const resultElement = document.querySelector('.search-result.selected') as HTMLElement;
        const indexAttr = resultElement?.getAttribute('data-coord-index');
        if (indexAttr) {
            coordIndex = parseInt(indexAttr);
        }
    }
    
    selectLocation(result.location, coordIndex);
    closeSearch();
  }

  searchInput.addEventListener('keydown', (e) => {
    const results = resultsContainer.querySelectorAll('.search-result');
    const maxIndex = results.length - 1;

    switch(e.key) {
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          const selected = results[selectedIndex] as HTMLElement;
          const name = selected.getAttribute('data-name');
          
          const location = locations.find(l => l.name === name);
          if (location) {
            selectResult({ location, score: 0 }, selected);
          }
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, maxIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Escape':
        closeSearch();
        break;
    }

    results.forEach((result, index) => {
      result.classList.toggle('selected', index === selectedIndex);
    });
  });

  searchInput.addEventListener('input', async () => {
    const query = searchInput.value.trim();
    if (query.length > 0) {
      const results = await searchAll(query);
      updateResults(results);
    } else {
      resultsContainer.style.display = 'none';
    }
  });

  function openSearch() {
    searchContainer.classList.add('expanded');
    searchOverlay.classList.add('active');
    searchInput.focus();
    selectedIndex = -1;
  }

  function closeSearch() {
    searchContainer.classList.remove('expanded');
    searchOverlay.classList.remove('active');
    resultsContainer.style.display = 'none';
    searchInput.value = '';
    selectedIndex = -1;
  }

  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearch();
    }
  });

  resultsContainer.addEventListener('click', async (e) => {
    const resultElement = (e.target as HTMLElement).closest('.search-result');
    if (!resultElement) return;

    const name = resultElement.getAttribute('data-name');
    const location = locations.find(l => l.name === name);
    
    if (location) {
      selectResult({ location, score: 0 }, resultElement);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      if (searchContainer.classList.contains('expanded')) {
        closeSearch();
      } else {
        openSearch();
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target as Node)) {
      closeSearch();
    }
  });
}

function highlightText(text: string, query?: string): string {
  if (!query) return text;
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const parts = normalizedText.split(normalizedQuery);
  
  if (parts.length === 1) return text;
  
  let result = '';
  let lastIndex = 0;
  
  parts.forEach((part, index) => {
    const startIndex = lastIndex + part.length;
    const endIndex = startIndex + normalizedQuery.length;
    
    result += text.slice(lastIndex, startIndex);
    if (index < parts.length - 1) {
      result += `<mark>${text.slice(startIndex, endIndex)}</mark>`;
    }
    
    lastIndex = endIndex;
  });
  
  return result;
}

// Add getIconUrl function
function getIconUrl(iconPath: string): string {
  if (!iconPath) return '';
  
  // Check if it's a full URL or Font Awesome (which doesn't need processing)
  if (/^(https?:\/\/)/.test(iconPath) || iconPath.startsWith('fa-')) {
    return iconPath;
  }

  // Ensure we have a consistent base URL for all icons
  const normalizedPath = iconPath.startsWith('/') ? iconPath : `/${iconPath}`;
  const pathWithoutExtension = normalizedPath.replace(/\.svg$/, '');
  const cacheBuster = new Date().getMonth();

  return `${pathWithoutExtension}.svg?v=${cacheBuster}`;
}

function renderLocationResult(location: Location & { type: string }, index: number, selectedIndex: number, allLocations: (Location & { type: string })[]): string {
  const isMultiLocation = Array.isArray(location.coordinates[0]);
  let result = '';

  if (isMultiLocation) {
    result = `
      <div class="search-result parent-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="location"
           data-name="${location.name}">
        <div class="search-result-icon">
          ${location.icon?.startsWith('fa-') 
            ? `<i class="${location.icon}" style="color: ${location.iconColor || '#FFFFFF'}"></i>`
            : `<img src="${getIconUrl(location.icon)}" alt="">`}
        </div>
        <div class="search-result-content">
          <div class="result-name">${highlightText(location.name)}</div>
          ${location.description 
            ? `<div class="result-description">${highlightText(location.description)}</div>` 
            : ''}
        </div>
      </div>`;

    (location.coordinates as [number, number][]).forEach((coord, idx) => {
      const namedLocations = allLocations.filter(loc => loc.type === 'location');
      const nearestLocation = namedLocations.reduce((nearest, loc) => {
        const locCoords = loc.coordinates as [number, number];
        const currentDist = Math.hypot(coord[0] - locCoords[0], coord[1] - locCoords[1]);
        const nearestDist = Math.hypot(
          coord[0] - (nearest.coordinates as [number, number])[0],
          coord[1] - (nearest.coordinates as [number, number])[1]
        );
        return currentDist < nearestDist ? loc : nearest;
      }, namedLocations[0]);

      const direction = nearestLocation 
        ? `${getRelativeDirection(coord, nearestLocation.coordinates as [number, number])} of ${nearestLocation.name}`
        : '';
      
      result += `
        <div class="search-result child-result ${index === selectedIndex ? 'selected' : ''}" 
             data-type="location"
             data-name="${location.name}"
             data-coord-index="${idx}">
          <div class="location-ref">
            <span class="location-index">#${idx + 1}</span>
            ${direction ? `<span class="direction-text">${direction}</span>` : ''}
          </div>
        </div>`;
    });
  } else {
    result = `
      <div class="search-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="location"
           data-name="${location.name}">
        <div class="search-result-icon">
          ${location.icon?.startsWith('fa-') 
            ? `<i class="${location.icon}" style="color: ${location.iconColor || '#FFFFFF'}"></i>`
            : `<img src="${getIconUrl(location.icon)}" alt="">`}
        </div>
        <div class="search-result-content">
          <div class="result-name">
            ${highlightText(location.name)}
            ${location.type !== 'location' 
              ? `<span class="location-type">${location.type}</span>` 
              : ''}
          </div>
          ${location.description 
            ? `<div class="result-description">${highlightText(location.description)}</div>` 
            : ''}
        </div>
      </div>`;
  }

  return result;
}

function findNearestLocationMarker(coords: [number, number], allLocations: (Location & { type: string })[]): Location & { type: string } | null {
  const locationMarkers = allLocations.filter(loc => loc.type === 'location');
  
  if (locationMarkers.length === 0) return null;

  return locationMarkers.reduce((nearest, loc) => {
    const locCoords = loc.coordinates as [number, number];
    const currentDist = Math.hypot(
        coords[0] - locCoords[0],
        coords[1] - locCoords[1]
    );
    
    const nearestCoords = nearest.coordinates as [number, number];
    const nearestDist = Math.hypot(
        coords[0] - nearestCoords[0],
        coords[1] - nearestCoords[1]
    );

    return currentDist < nearestDist ? loc : nearest;
  });
}

function findNearestNamedLocation(coords: [number, number], locations: (Location & { type: string })[]): Location & { type: string } | null {
  const locationMarkers = locations.filter(loc => loc.type === 'location');
  
  if (locationMarkers.length === 0) return null;

  return locationMarkers.reduce((nearest, loc) => {
    const locCoords = loc.coordinates as [number, number];
    const currentDist = Math.hypot(coords[0] - locCoords[0], coords[1] - locCoords[1]);
    
    const nearestCoords = nearest.coordinates as [number, number];
    const nearestDist = Math.hypot(coords[0] - nearestCoords[0], coords[1] - nearestCoords[1]);

    return currentDist < nearestDist ? loc : nearest;
  });
}

function generateLocationHash(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function calculateOptimalZoom(distance: number): number {
  if (distance > 10000) return -2;
  if (distance > 5000) return -1;
  if (distance > 2000) return 0;
  if (distance > 1000) return 1;
  return 2;
}

function calculateAnimationDuration(distance: number): number {
  const baseDuration = 1.2;
  const distanceFactor = Math.min(distance / 5000, 1);
  const zoomFactor = 0.5;
  
  return baseDuration + distanceFactor * 1.5 + zoomFactor * 0.8;
}