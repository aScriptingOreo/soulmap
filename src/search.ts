import type { Location } from './types';
import * as L from 'leaflet';
import { getRelativeDirection } from './utils';

interface SearchResult {
  location: Location & { type: string };
  score: number;
}

export function initializeSearch(locations: (Location & { type: string })[], map: L.Map, markers: L.Marker[]) {
  const searchContainer = document.querySelector('.search-container') as HTMLElement;
  const searchOverlay = document.querySelector('.search-overlay') as HTMLElement;
  
  searchContainer.innerHTML = `
    <input type="text" id="location-search" placeholder="Press Ctrl + Space to search...">
    <div class="search-results"></div>
  `;

  const searchInput = document.getElementById('location-search') as HTMLInputElement;
  const resultsContainer = document.querySelector('.search-results') as HTMLDivElement;
  let selectedIndex = -1;

  function searchLocations(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const normalizedQuery = query.toLowerCase();
    const terms = normalizedQuery.split(' ').filter(term => term.length > 0);

    locations.forEach(location => {
      let score = 0;
      const name = location.name.toLowerCase();
      const description = (location.description || '').toLowerCase();

      terms.forEach(term => {
        // Name matches
        if (name === term) score += 100;
        if (name.includes(term)) score += 75;
        if (name.split(' ').some(word => word.startsWith(term))) score += 60;

        // Description matches
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
                const location = result.location;
                const isMultiLocation = Array.isArray(location.coordinates[0]);
                const mainCoord = isMultiLocation ? 
                    location.coordinates[0] as [number, number] : 
                    location.coordinates as [number, number];

                // Create highlight function based on search terms
                function highlightText(text: string): string {
                    const terms = searchInput.value.toLowerCase().split(' ').filter(t => t);
                    let highlighted = text;
                    terms.forEach(term => {
                        const regex = new RegExp(`(${term})`, 'gi');
                        highlighted = highlighted.replace(regex, '<mark>$1</mark>');
                    });
                    return highlighted;
                }

                // Generate main result entry
                const mainEntry = `
                    <div class="search-result ${index === selectedIndex ? 'selected' : ''}" 
                         data-name="${location.name}">
                        <div class="search-result-icon">
                            ${location.icon?.startsWith('fa-') 
                                ? `<i class="${location.icon}" style="color: ${location.iconColor || '#FFFFFF'}; 
                                   font-size: ${location.iconSize ? 24 * location.iconSize : 24}px;"></i>`
                                : `<img src="${location.icon}.svg" style="width: ${location.iconSize ? 24 * location.iconSize : 24}px; 
                                   height: ${location.iconSize ? 24 * location.iconSize : 24}px;" alt="">`
                            }
                        </div>
                        <div class="search-result-content">
                            <div class="result-name">
                                ${highlightText(location.name)}
                            </div>
                            ${location.description 
                                ? `<div class="result-description">${highlightText(location.description)}</div>` 
                                : ''}
                        </div>
                        ${location.imgUrl 
                            ? `<img class="search-result-image" src="${location.imgUrl}" alt="${location.name}">` 
                            : ''}
                    </div>`;

                // Generate child entries if multi-location
                let childEntries = '';
                if (isMultiLocation) {
                    const coords = location.coordinates as [number, number][];
                    childEntries = coords.map((coord, coordIndex) => {
                        const nearestLocation = findNearestLocationMarker(coord, locations);
                        const relativeLocation = nearestLocation ? 
                            `${getRelativeDirection(nearestLocation.coordinates as [number, number], coord)} of ${nearestLocation.name}` : '';

                        return `
                            <div class="search-result child-result ${index === selectedIndex ? 'selected' : ''}" 
                                 data-name="${location.name}"
                                 data-coord-index="${coordIndex}">
                                <div class="search-result-content">
                                    <div class="result-location">
                                        #${coordIndex + 1} - ${relativeLocation}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }

                return mainEntry + childEntries;
            })
            .join('');
    } else {
        resultsContainer.innerHTML = '<div class="no-results">No locations found</div>';
    }
    resultsContainer.style.display = 'block';
}

  function selectLocation(location: Location & { type: string }, coordIndex?: number) {
    const coords = Array.isArray(location.coordinates[0]) 
        ? (coordIndex !== undefined 
            ? location.coordinates[coordIndex] 
            : location.coordinates[0]) as [number, number]
        : location.coordinates as [number, number];

    map.setView([coords[1], coords[0]], map.getZoom());

    // Update URL with location parameter and index if applicable
    const encodedLocation = encodeURIComponent(location.name);
    const urlParams = coordIndex !== undefined 
        ? `?loc=${encodedLocation}&index=${coordIndex}` 
        : `?loc=${encodedLocation}`;
    window.history.replaceState({}, '', urlParams);

    // Find and trigger correct marker
    const marker = markers.find(m => {
        const pos = m.getLatLng();
        const markerContent = m.getTooltip()?.getContent();
        if (coordIndex !== undefined) {
            // For multi-location items, match both position and index
            return pos.lat === coords[1] && 
                   pos.lng === coords[0] && 
                   markerContent?.includes(`#${coordIndex + 1}`);
        }
        return pos.lat === coords[1] && pos.lng === coords[0];
    });

    if (marker) {
        document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        marker.getElement()?.classList.add('selected');
        marker.fire('click');
    }

    // Close search after selection
    closeSearch();
}

// Handle keyboard navigation
searchInput.addEventListener('keydown', (e) => {
    const results = resultsContainer.querySelectorAll('.search-result');
    const maxIndex = results.length - 1;

    switch(e.key) {
        case 'Enter':
            e.preventDefault();
            if (selectedIndex >= 0) {
                const selected = results[selectedIndex] as HTMLElement;
                const locationName = selected.getAttribute('data-name');
                const coordIndex = selected.getAttribute('data-coord-index');
                const location = locations.find(l => l.name === locationName);
                if (location) {
                    selectLocation(location, coordIndex ? parseInt(coordIndex) : undefined);
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

    // Update selected state
    results.forEach((result, index) => {
        result.classList.toggle('selected', index === selectedIndex);
    });
});

  // Add input handler
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (query.length > 0) {
      const results = searchLocations(query);
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

  // Click handler for overlay
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearch();
    }
  });

  // Click handlers for results
  resultsContainer.addEventListener('click', (e) => {
    const resultElement = (e.target as HTMLElement).closest('.search-result');
    if (resultElement) {
        const locationName = resultElement.getAttribute('data-name');
        const coordIndex = resultElement.getAttribute('data-coord-index');
        const location = locations.find(l => l.name === locationName);
        if (location) {
            selectLocation(location, coordIndex ? parseInt(coordIndex) : undefined);
        }
    }
  });

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      // Toggle search state
      if (searchContainer.classList.contains('expanded')) {
        closeSearch();
      } else {
        openSearch();
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target as Node)) {
      closeSearch();
    }
  });

  // Rest of the existing event listeners...
}

function findNearestLocationMarker(coords: [number, number], allLocations: (Location & { type: string })[]): Location & { type: string } | null {
    // Filter for location type markers only
    const locationMarkers = allLocations.filter(loc => loc.type === 'location');
    
    if (locationMarkers.length === 0) return null;

    return locationMarkers.reduce((nearest, loc) => {
        const locCoords = loc.coordinates as [number, number]; // Location markers are always single point
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