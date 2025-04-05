import type { Location } from './types';
import * as L from 'leaflet';
import { getRelativeDirection } from './utils';
import { setMarkerVisibility } from './services/visibilityMiddleware';
import { tempMarker, createTemporaryMarker, updateMetaTags, removeTemporaryMarker, getMap } from './map';
import analytics from './analytics';

interface SearchResult {
  location: Location & { type: string };
  score: number;
}

// Store references to shared data at module level
let locations: (Location & { type: string })[] = [];
let markers: L.Marker[] = [];
let mainMap: L.Map | null = null;

// Helper functions moved to module scope
function selectCoordinates(coords: [number, number]) {
  const [x, y] = coords;
  
  // Use the stored map reference or get it from the global function
  const activeMap = mainMap || getMap();
  
  if (!activeMap) {
    console.warn("Cannot select coordinates: map is not initialized");
    
    // Even without a map, we can still update the URL
    if (!window.isHandlingHistoryNavigation) {
      const urlParams = new URLSearchParams();
      urlParams.set('coord', `${Math.round(x)},${Math.round(y)}`);
      window.history.replaceState({}, '', `?${urlParams.toString()}`);
    }
    
    // Update metadata
    updateMetaTags(null, [x, y]);
    
    // Try to update sidebar content
    window.sidebarInstance?.updateContent(null, x, y);
    
    return;
  }
  
  // Check if coordinates match any exact marker first
  const exactMarker = markers.find(marker => {
    const pos = marker.getLatLng();
    return Math.abs(pos.lng - x) < 5 && Math.abs(pos.lat - y) < 5;
  });
  
  if (exactMarker) {
    // If clicking on an exact marker, remove any temporary marker
    removeTemporaryMarker(activeMap);
    
    exactMarker.fire('click');
  } else {
    // Create temporary marker using the shared function from map.ts
    const latLng = L.latLng(y, x);
    createTemporaryMarker(latLng, activeMap);
    
    // Center map on coordinates
    activeMap.setView([y, x], activeMap.getZoom() || 0);
    
    // Update URL and sidebar
    if (!window.isHandlingHistoryNavigation) {
      const urlParams = new URLSearchParams();
      urlParams.set('coord', `${Math.round(x)},${Math.round(y)}`);
      window.history.replaceState({}, '', `?${urlParams.toString()}`);
    }
    
    // Update document title for coordinates
    updateMetaTags(null, [x, y]);
    
    // Use the sidebar to show the coordinate
    window.sidebarInstance?.updateContent(null, x, y, findNearestNamedLocation([x, y], locations));
  }
}

function selectLocation(location: Location & { type: string }, coordIndex?: number) {
  // Use the stored map reference or get it from global function
  const activeMap = mainMap || getMap();
  
  try {
    // Safe extraction of coordinates with validation
    const isMultiLocation = Array.isArray(location.coordinates[0]);
    let coords: [number, number];
    
    if (isMultiLocation) {
      // Multi-location case
      if (coordIndex !== undefined && coordIndex >= 0 && coordIndex < (location.coordinates as any[]).length) {
        const coordItem = (location.coordinates as any[])[coordIndex];
        if (Array.isArray(coordItem) && coordItem.length === 2 && 
            typeof coordItem[0] === 'number' && typeof coordItem[1] === 'number') {
          coords = coordItem as [number, number];
        } else if (coordItem && coordItem.coordinates && 
                   Array.isArray(coordItem.coordinates) && coordItem.coordinates.length === 2) {
          // Handle CoordinateProperties object
          coords = coordItem.coordinates as [number, number];
        } else {
          console.error(`Invalid coordinate format for ${location.name} at index ${coordIndex}:`, coordItem);
          return;
        }
      } else {
        // Default to first coordinate if index is invalid
        const coordItem = (location.coordinates as any[])[0];
        if (Array.isArray(coordItem) && coordItem.length === 2) {
          coords = coordItem as [number, number];
        } else if (coordItem && coordItem.coordinates && 
                   Array.isArray(coordItem.coordinates) && coordItem.coordinates.length === 2) {
          coords = coordItem.coordinates as [number, number];
        } else {
          console.error(`Invalid default coordinate format for ${location.name}:`, coordItem);
          return;
        }
      }
    } else {
      // Single location case - ensure it's a valid coordinate pair
      const coord = location.coordinates;
      
      // Handle different coordinate formats
      if (Array.isArray(coord) && coord.length === 2 && 
          typeof coord[0] === 'number' && typeof coord[1] === 'number') {
        // Simple [x, y] format
        coords = coord as [number, number];
      } 
      // Handle the case where coordinates is an array of CoordinateProperties
      else if (Array.isArray(coord) && coord.length > 0 && typeof coord[0] === 'object') {
        const firstItem = coord[0] as any;
        if (firstItem.coordinates && Array.isArray(firstItem.coordinates) && 
            firstItem.coordinates.length === 2) {
          coords = firstItem.coordinates as [number, number];
          console.log(`Using coordinates from first item in array for ${location.name}:`, coords);
        } else {
          console.error(`Invalid coordinate object format for ${location.name}:`, firstItem);
          return;
        }
      }
      // Some other invalid format
      else {
        console.error(`Invalid single coordinate format for ${location.name}:`, coord);
        return;
      }
    }

    // Validate coordinates are valid numbers
    if (!coords || coords.length !== 2 || 
        typeof coords[0] !== 'number' || isNaN(coords[0]) ||
        typeof coords[1] !== 'number' || isNaN(coords[1])) {
      console.error(`Invalid coordinates for ${location.name}:`, coords);
      return;
    }

    // Important: First update the sidebar content before animating the map
    // This prevents the "bounce" issue between locations
    if (window.sidebarInstance) {
      // Get coordinate values for sidebar update
      const locationCoords = getCoordinateForSidebar(location, coordIndex);
      if (locationCoords) {
        window.sidebarInstance.updateContent(
          location, 
          locationCoords[0], 
          locationCoords[1], 
          coordIndex
        );
      }
      
      // Mark the currently selected marker
      document.querySelectorAll('.custom-location-icon.selected').forEach(el => {
          el.classList.remove('selected');
      });
    }

    if (!activeMap) {
      console.warn("Cannot select location: map is not initialized");
      return;
    }

    // Then do the map animation
    const currentCenter = activeMap.getCenter();
    
    // Safe distance calculation with validated coordinates
    const distance = activeMap.distance(
        L.latLng(currentCenter.lat, currentCenter.lng),
        L.latLng(coords[1], coords[0])
    );

    const targetZoom = calculateOptimalZoom(distance);
    const duration = calculateAnimationDuration(distance);

    activeMap.once("movestart", () => {
        document
            .querySelector(".leaflet-marker-pane")
            ?.classList.add("leaflet-zoom-hide");
    });

    activeMap.once("moveend", () => {
        document
            .querySelector(".leaflet-marker-pane")
            ?.classList.remove("leaflet-zoom-hide");
    });

    activeMap.flyTo([coords[1], coords[0]], targetZoom, {
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

    // Find and highlight the marker but DON'T trigger its click event
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
              markerElement.classList.add('selected');
              if ((marker as any).uncertaintyCircle) {
                  (marker as any).uncertaintyCircle.setStyle({
                      opacity: 0.6,
                      fillOpacity: 0.2
                  });
              }
          }
          
          marker.setLatLng(marker.getLatLng());
      });

      // Skip browser history update if triggered by URL change
      if (!window.isHandlingHistoryNavigation) {
        const locationHash = generateLocationHash(location.name);
        // Convert from 0-based (internal) to 1-based (URL)
        const urlParams = isMultiLocation && coordIndex !== undefined
            ? `?loc=${locationHash}&index=${coordIndex + 1}`
            : `?loc=${locationHash}`;
        window.history.replaceState({}, '', urlParams);
      }
    }

    // Hide search bar on small screens when a location is selected from search
    if (window.innerWidth < 768 || (window.innerWidth / window.innerHeight < 1)) {
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.classList.add('hidden-mobile');
        }
    }
  } catch (error) {
    console.error(`Error processing location ${location.name}:`, error);
    
    // Fallback to direct view without animation in case of error
    try {
      if (coords && coords.length === 2) {
        activeMap.setView([coords[1], coords[0]], 0);
        window.sidebarInstance?.updateContent(location, coords[0], coords[1], coordIndex);
      }
    } catch (fallbackError) {
      console.error("Fallback navigation failed:", fallbackError);
    }
    return;
  }
}

// Helper function to get the coordinates for sidebar updates
function getCoordinateForSidebar(location: Location & { type: string }, coordIndex?: number): [number, number] | null {
  try {
    const isMultiLocation = Array.isArray(location.coordinates[0]);
    
    if (isMultiLocation) {
      // Multi-location case
      if (coordIndex !== undefined && coordIndex >= 0 && coordIndex < (location.coordinates as any[]).length) {
        const coordItem = (location.coordinates as any[])[coordIndex];
        if (Array.isArray(coordItem) && coordItem.length === 2) {
          return coordItem as [number, number];
        } else if (coordItem && coordItem.coordinates && Array.isArray(coordItem.coordinates)) {
          return coordItem.coordinates as [number, number];
        }
      } else {
        // Default to first coordinate
        const coordItem = (location.coordinates as any[])[0];
        if (Array.isArray(coordItem) && coordItem.length === 2) {
          return coordItem as [number, number];
        } else if (coordItem && coordItem.coordinates && Array.isArray(coordItem.coordinates)) {
          return coordItem.coordinates as [number, number];
        }
      }
    } else {
      // Single location case
      const coord = location.coordinates;
      if (Array.isArray(coord) && coord.length === 2) {
        return coord as [number, number];
      } else if (typeof coord[0] === 'object') {
        const firstItem = coord[0] as any;
        if (firstItem.coordinates && Array.isArray(firstItem.coordinates)) {
          return firstItem.coordinates as [number, number];
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error getting coordinates for sidebar:", error);
    return null;
  }
}

// Helper functions used by selectLocation and selectCoordinates
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

// Export this function so it can be used in other modules
export function generateLocationHash(name: string): string {
  // Ensure consistent hashing logic for location names
  return name.toLowerCase()
    .replace(/\s+/g, '-')    // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')  // Remove non-alphanumeric chars except hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/-+/g, '-');    // Replace multiple hyphens with one
}

export async function initializeSearch(locationsData: (Location & { type: string })[], map: L.Map | null, markersData: L.Marker[]) {
  // Store variables at module scope for use by navigation functions
  locations = locationsData;
  markers = markersData;
  mainMap = map;
  
  const searchContainer = document.querySelector('.search-container') as HTMLElement;
  const searchOverlay = document.querySelector('.search-overlay') as HTMLElement;
  
  // Add the Font Awesome icon to the container
  searchContainer.innerHTML = `
    <i class="fa-solid fa-magnifying-glass"></i>
    <input type="text" id="location-search" placeholder="Press Ctrl + Space to search...">
    <div class="search-results"></div>
  `;

  const searchInput = document.getElementById('location-search') as HTMLInputElement;
  const resultsContainer = document.querySelector('.search-results') as HTMLDivElement;
  const searchIcon = searchContainer.querySelector('.fa-magnifying-glass') as HTMLElement;
  let selectedIndex = -1;
  
  // Check if we're on mobile
  const isMobile = () => window.innerWidth < 768 || (window.innerWidth / window.innerHeight < 1);

  // Mobile-specific event handlers
  if (isMobile()) {
    // Update placeholder text for mobile
    searchInput.placeholder = "Search locations...";
    
    // Make icon clickable and expand search on click
    searchIcon.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent clicks from bubbling to document
      if (!searchContainer.classList.contains('expanded')) {
        expandSearch();
      }
    });
    
    // Click on container also expands search
    searchContainer.addEventListener('click', (e) => {
      if (!searchContainer.classList.contains('expanded') && e.target === searchContainer) {
        e.stopPropagation();
        expandSearch();
      }
    });

    // Click outside search container collapses it
    document.addEventListener('click', (e) => {
      if (
        searchContainer.classList.contains('expanded') && 
        !searchContainer.contains(e.target as Node) &&
        !resultsContainer.contains(e.target as Node)
      ) {
        collapseSearch();
      }
    });

    // Handle focus on input for better mobile experience
    searchInput.addEventListener('focus', () => {
      if (!searchContainer.classList.contains('expanded')) {
        expandSearch();
      }
    });
  }

  // Search expansion functions for mobile
  function expandSearch() {
    searchContainer.classList.add('expanded');
    setTimeout(() => searchInput.focus(), 300); // Delay focus until animation completes
  }

  function collapseSearch() {
    searchContainer.classList.remove('expanded');
    searchInput.value = '';
    resultsContainer.style.display = 'none';
    selectedIndex = -1;
  }

  async function searchAll(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const normalizedQuery = query.toLowerCase();
    const terms = normalizedQuery.split(' ').filter(term => term.length > 0);

    // Check for coordinate patterns first
    const coordPatterns = [
      /^\[?\s*(\d+)\s*,\s*(\d+)\s*\]?$/, // [X, Y] or X,Y
      /^\[?\s*(\d+)\s*\|\s*(\d+)\s*\]?$/, // [X|Y] or X|Y
      /^\[?\s*(\d+)\s+(\d+)\s*\]?$/       // [X Y] or X Y
    ];
    
    let coordMatch: RegExpMatchArray | null = null;
    
    for (const pattern of coordPatterns) {
      coordMatch = normalizedQuery.match(pattern);
      if (coordMatch) {
        const x = parseInt(coordMatch[1], 10);
        const y = parseInt(coordMatch[2], 10);
        
        if (!isNaN(x) && !isNaN(y)) {
          // Find the nearest location to these coordinates
          const nearestLocation = locations
            .filter(loc => loc.type === 'location')
            .reduce((nearest, loc) => {
              const locCoords = Array.isArray(loc.coordinates[0]) 
                ? loc.coordinates[0] 
                : loc.coordinates as [number, number];
              
              const currentDist = Math.hypot(x - locCoords[0], y - locCoords[1]);
              const nearestDist = nearest ? Math.hypot(
                x - (Array.isArray(nearest.coordinates[0]) 
                  ? nearest.coordinates[0][0] 
                  : nearest.coordinates[0]),
                y - (Array.isArray(nearest.coordinates[0])
                  ? nearest.coordinates[0][1]
                  : nearest.coordinates[1])
              ) : Infinity;
              
              return currentDist < nearestDist ? loc : nearest;
            }, null as (Location & { type: string }) | null);
          
          if (nearestLocation) {
            const nearestCoords = Array.isArray(nearestLocation.coordinates[0])
              ? nearestLocation.coordinates[0] as [number, number]
              : nearestLocation.coordinates as [number, number];
              
            const direction = getRelativeDirection(
              [x, y],
              nearestCoords
            );
            
            // Add coordinate result
            results.push({
              location: {
                name: `Coordinates [${x}, ${y}]`,
                coordinates: [x, y],
                description: `${direction} of ${nearestLocation.name}`,
                type: 'coordinate',
                isCoordinateSearch: true
              } as unknown as (Location & { type: string }),
              score: 100
            });
          }
          
          // Check if we have an exact match with any marker
          const exactMarkerMatch = markers.find(marker => {
            const pos = marker.getLatLng();
            // Allow for a small margin of error
            return Math.abs(pos.lng - x) < 5 && Math.abs(pos.lat - y) < 5;
          });
          
          if (exactMarkerMatch) {
            const markerContent = exactMarkerMatch.getTooltip()?.getContent() as string;
            const matchedLocation = locations.find(loc => {
              if (markerContent?.includes(loc.name)) {
                // Check if it's a specific coordinate in a multi-location
                if (Array.isArray(loc.coordinates[0])) {
                  const allCoords = loc.coordinates as [number, number][];
                  return allCoords.some(coord => 
                    Math.abs(coord[0] - x) < 5 && Math.abs(coord[1] - y) < 5
                  );
                } else {
                  const coord = loc.coordinates as [number, number];
                  return Math.abs(coord[0] - x) < 5 && Math.abs(coord[1] - y) < 5;
                }
              }
              return false;
            });
            
            if (matchedLocation) {
              results.push({
                location: matchedLocation,
                score: 150 // Higher score for exact marker matches
              });
            }
          }
        }
        break; // Stop checking other patterns if we have a match
      }
    }

    // Regular search for locations
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
      // Track search with result count
      analytics.trackSearch(searchInput.value.trim(), results.length);
      
      resultsContainer.innerHTML = results
        .slice(0, 8)
        .map((result, index) => {
          return renderLocationResult(result.location, index, selectedIndex, locations);
        })
        .join('');
    } else {
      // Track search with no results
      analytics.trackSearch(searchInput.value.trim(), 0);
      
      resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
    }
    resultsContainer.style.display = 'block';
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
          } else if (name?.startsWith('Coordinates ')) {
            // Handle coordinate search
            const coordMatch = name.match(/\[(\d+),\s*(\d+)\]/);
            if (coordMatch) {
              const x = parseInt(coordMatch[1], 10);
              const y = parseInt(coordMatch[2], 10);
              
              if (!isNaN(x) && !isNaN(y)) {
                selectCoordinates([x, y]);
              }
            }
          }
        } else {
          // Direct coordinate entry in the search box
          const query = searchInput.value.trim();
          for (const pattern of [
            /^\[?\s*(\d+)\s*,\s*(\d+)\s*\]?$/, 
            /^\[?\s*(\d+)\s*\|\s*(\d+)\s*\]?$/, 
            /^\[?\s*(\d+)\s+(\d+)\s*\]?$/
          ]) {
            const match = query.match(pattern);
            if (match) {
              const x = parseInt(match[1], 10);
              const y = parseInt(match[2], 10);
              
              if (!isNaN(x) && !isNaN(y)) {
                selectCoordinates([x, y]);
                break;
              }
            }
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

  // Update closeSearch function to handle mobile UI state
  function closeSearch() {
    searchContainer.classList.remove('expanded');
    searchOverlay.classList.remove('active');
    resultsContainer.style.display = 'none';
    searchInput.value = '';
    selectedIndex = -1;
    
    // For mobile, collapse back to icon
    if (isMobile()) {
      collapseSearch();
    }
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
  
  // Internal function to select a search result
  function selectResult(result: SearchResult, clickedElement?: HTMLElement) {
    // Track search result selection
    analytics.trackEvent('search_result_click', {
      location_name: result.location.name,
      location_type: result.location.type
    });
    
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
  // Handle coordinate search result specially
  if (location.isCoordinateSearch) {
    return `
      <div class="search-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="coordinate"
           data-name="${location.name}">
        <div class="search-result-icon">
          <span class="material-icons">my_location</span>
        </div>
        <div class="search-result-content">
          <div class="result-name">${location.name}</div>
          <div class="result-description">${location.description}</div>
        </div>
      </div>`;
  }

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

// Update exported functions to use the module-level functions
export function navigateToLocation(locationSlug: string, coordIndex?: number): void {
  // Check if we've just navigated to this location to prevent loops
  if (window.lastNavigatedLocation === locationSlug && 
      window.lastNavigatedIndex === coordIndex) {
    console.log('Already at this location, skipping navigation');
    return;
  }
  
  console.log('Navigating to location slug:', locationSlug);
  
  // Store this navigation to prevent loops
  window.lastNavigatedLocation = locationSlug;
  window.lastNavigatedIndex = coordIndex;
  
  // Rest of the function (look up the location)
  // Check if we have a location with this exact name first (for special non-hashed names)
  let location = locations.find(l => l.name.toLowerCase() === locationSlug.toLowerCase());
  
  // If not found by direct name match, try the standard slug approaches
  if (!location) {
    // Try to find by generated hash
    location = locations.find(l => generateLocationHash(l.name) === locationSlug);
    
    // If not found, try with simpler normalization (just spaces to hyphens)
    if (!location) {
      location = locations.find(l => 
        l.name.toLowerCase().replace(/\s+/g, '-') === locationSlug
      );
    }
    
    // If still not found, try a more lenient match
    if (!location) {
      const normalizedSlug = locationSlug.toLowerCase().replace(/-/g, ' ');
      location = locations.find(l => 
        l.name.toLowerCase() === normalizedSlug || 
        l.name.toLowerCase().includes(normalizedSlug)
      );
    }
    
    // Add special case for well-known location slugs
    if (!location) {
      if (locationSlug === 'oob-entrypoint') {
        // Look for locations mentioning "out of bounds" or with specific descriptions
        location = locations.find(l => 
          (l.name.toLowerCase().includes('out of bounds')) ||
          (l.description?.toLowerCase().includes('out of bounds') && 
          l.description?.toLowerCase().includes('entrypoint'))
        );
      } else if (locationSlug === 'this-area-is-out-of-bounds') {
        location = locations.find(l => l.name === 'This area is out of bounds');
      }
    }
  }
  
  if (!location) {
    // One last attempt - try finding the raw string without normalization
    for (const loc of locations) {
      if (locationSlug === loc.name) {
        location = loc;
        break;
      }
    }
  }
  
  if (!location) {
    console.warn(`Location not found for slug: ${locationSlug}`);
    console.log('Available locations:', locations.slice(0, 10).map(l => ({ 
      name: l.name, 
      hash: generateLocationHash(l.name),
      simpleSlug: l.name.toLowerCase().replace(/\s+/g, '-') 
    })));
    return;
  }
  
  console.log('Found location:', location.name, 'with coordinates:', location.coordinates);
  
  // Set a navigation timeout to prevent rapid sequential navigation to the same location
  if (window.navigationTimeout) {
    clearTimeout(window.navigationTimeout);
  }
  
  // Set a short timeout for navigation to prevent multiple rapid navigations
  window.navigationInProgress = true;
  window.navigationTimeout = setTimeout(() => {
    selectLocation(location, coordIndex);
    // Reset navigation progress flag after a short delay
    setTimeout(() => {
      window.navigationInProgress = false;
    }, 250);
  }, 50);
}

export function navigateToCoordinates(coords: [number, number]): void {
  selectCoordinates(coords);
}

// Add global declaration at the end of the file:
declare global {
  interface Window {
    lastNavigatedLocation?: string;
    lastNavigatedIndex?: number;
    navigationTimeout?: number;
    navigationInProgress?: boolean;
    navigateToCoordinates?: (coords: [number, number]) => void;
  }
}

// Make the navigateToCoordinates function globally accessible
window.navigateToCoordinates = navigateToCoordinates;