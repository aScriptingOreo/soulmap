import type { ItemDrop, Location } from './types';
import * as L from 'leaflet';
import { getRelativeDirection } from './utils';
import { loadDrops } from './drops/dropsLoader';

interface SearchResult {
  type: 'location' | 'drop';
  location?: Location & { type: string };
  drop?: ItemDrop;
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

    // Search locations
    locations.forEach(location => {
      let score = 0;
      const name = location.name.toLowerCase();
      const description = (location.description || '').toLowerCase();

      terms.forEach(term => {
        // Existing location scoring logic
        if (name === term) score += 100;
        if (name.includes(term)) score += 75;
        if (name.split(' ').some(word => word.startsWith(term))) score += 60;
        if (description === term) score += 50;
        if (description.includes(term)) score += 25;
        if (description.split(' ').some(word => word.startsWith(term))) score += 20;
      });

      if (score > 0) {
        results.push({ type: 'location', location, score });
      }
    });

    // Search drops
    const drops = await loadDrops();
    Object.values(drops).flat().forEach(drop => {
      let score = 0;
      const name = drop.name.toLowerCase();
      const description = drop.description.toLowerCase();
      const type = drop.type.toLowerCase();

      terms.forEach(term => {
        if (name === term) score += 100;
        if (name.includes(term)) score += 75;
        if (type === term) score += 60;
        if (description === term) score += 50;
        if (description.includes(term)) score += 25;
      });

      if (score > 0) {
        results.push({ type: 'drop', drop, score });
      }
    });

    return results.sort((a, b) => b.score - a.score);
  }

  function updateResults(results: SearchResult[]) {
    if (results.length > 0) {
      resultsContainer.innerHTML = results
        .slice(0, 8)
        .map((result, index) => {
          if (result.type === 'location') {
            return renderLocationResult(result.location!, index, selectedIndex, locations);
          } else {
            return renderDropResult(result.drop!, index, selectedIndex);
          }
        })
        .join('');
    } else {
      resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
    }
    resultsContainer.style.display = 'block';
  }

  function renderDropResult(drop: ItemDrop, index: number, selectedIndex: number): string {
    let iconHtml = '';
    if (drop.icon) {
      const size = drop.iconSize || 1;
      if (drop.icon.startsWith('fa-')) {
        iconHtml = `<i class="${drop.icon}" style="font-size: ${20 * size}px; color: ${drop.iconColor || '#FFFFFF'}; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);"></i>`;
      } else {
        iconHtml = `<img src="${drop.icon}.svg" style="width: ${20 * size}px; height: ${20 * size}px;" alt="">`;
      }
    } else {
      iconHtml = `<i class="fa-solid fa-box" style="color: ${drop.iconColor || '#FFFFFF'}"></i>`;
    }

    return `
      <div class="search-result drop-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="drop"
           data-name="${drop.name}">
        <div class="search-result-icon">
          ${iconHtml}
        </div>
        <div class="search-result-content">
          <div class="result-name">${highlightText(drop.name)}</div>
          <div class="result-type">
            <span class="rarity-badge" style="background-color: ${getRarityColor(drop.rarity)}">
              ${drop.rarity}
            </span>
            <span class="type-label">${drop.type}</span>
          </div>
          ${drop.description ? 
            `<div class="result-description">${highlightText(drop.description)}</div>` : 
            ''}
          <div class="result-sources">
            ${drop.sources.map(source => `
              <span class="source-tag">${source}</span>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Add helper function for rarity colors
  function getRarityColor(rarity: string): string {
    const rarityLower = rarity.toLowerCase();
    switch (rarityLower) {
      case 'common': return '#9e9e9e';
      case 'uncommon': return '#4CAF50';
      case 'rare': return '#2196F3';
      case 'quest': return '#9C27B0';
      default: return '#f44336';
    }
  }

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
        results.push({ type: 'location', location, score });
      }
    });

    return results.sort((a, b) => b.score - a.score);
  }

// Removed duplicate updateResults function

  function selectLocation(location: Location & { type: string }, coordIndex?: number) {
    const coords = Array.isArray(location.coordinates[0])
        ? (location.coordinates as [number, number][])[coordIndex ?? 0]
        : location.coordinates as [number, number];

    // Get current center to calculate distance
    const currentCenter = map.getCenter();
    const distance = map.distance(
        [currentCenter.lat, currentCenter.lng],
        [coords[1], coords[0]]
    );

    const targetZoom = calculateOptimalZoom(distance);
    const duration = calculateAnimationDuration(distance);

    // Disable marker animations during flyTo
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

    // Use the smooth flyTo animation
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

    // Find and trigger marker with delay for animation
    const marker = markers.find(m => {
        const pos = m.getLatLng();
        const tooltipContent = m.getTooltip()?.getContent() as string;
        
        return coordIndex !== undefined
            ? pos.lat === coords[1] && pos.lng === coords[0] && tooltipContent === `${location.name} #${coordIndex + 1}`
            : pos.lat === coords[1] && pos.lng === coords[0];
    });

    if (marker) {
        document.querySelectorAll('.custom-location-icon.selected').forEach(el => {
            el.classList.remove('selected');
        });
        marker.getElement()?.classList.add('selected');

        // Delay marker click until animation completes
        setTimeout(() => {
            marker.fire('click');
        }, duration * 1000);

        // Update URL
        const locationHash = generateLocationHash(location.name);
        const urlParams = coordIndex !== undefined
            ? `?loc=${locationHash}&index=${coordIndex}`
            : `?loc=${locationHash}`;
        window.history.replaceState({}, '', urlParams);
    }

    // Close search after selection
    closeSearch();
}

// Add these helper functions if they don't exist
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
    const currentZoom = map.getZoom();
    const targetZoom = calculateOptimalZoom(distance);
    const zoomDiff = Math.abs(currentZoom - targetZoom);
    const zoomFactor = Math.min(zoomDiff / 3, 1);

    return baseDuration + distanceFactor * 1.5 + zoomFactor * 0.8;
}

function selectResult(result: SearchResult) {
    if (result.type === 'location' && result.location) {
        // Switch to locations tab first
        const tabSystem = document.querySelector('.tab-system');
        const locationsTab = tabSystem?.querySelector('.sidebar-tab:nth-child(1)') as HTMLElement;
        if (locationsTab) {
            locationsTab.click();
        }

        // Check if this is a child item selection
        const resultElement = document.querySelector('.search-result.selected') as HTMLElement;
        const coordIndex = resultElement?.getAttribute('data-coord-index');
        
        // Pass the coordinate index if it exists
        selectLocation(result.location, coordIndex ? parseInt(coordIndex) : undefined);
    } else if (result.type === 'drop' && result.drop) {
        // ...existing drop handling code...
    }
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
        const type = selected.getAttribute('data-type');
        const name = selected.getAttribute('data-name');
        
        if (type === 'location') {
          const location = locations.find(l => l.name === name);
          if (location) {
            selectResult({ type: 'location', location, score: 0 });
          }
        } else if (type === 'drop') {
          loadDrops().then(drops => {
            const drop = Object.values(drops).flat().find(d => d.name === name);
            if (drop) {
              selectResult({ type: 'drop', drop, score: 0 });
            }
          });
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

  // Click handler for overlay
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearch();
    }
  });

  // Click handlers for results
  resultsContainer.addEventListener('click', async (e) => {
    const resultElement = (e.target as HTMLElement).closest('.search-result');
    if (!resultElement) return;

    const type = resultElement.getAttribute('data-type');
    const name = resultElement.getAttribute('data-name');

    if (type === 'location') {
      const location = locations.find(l => l.name === name);
      if (location) {
        selectResult({ type: 'location', location, score: 0 });
      }
    } else if (type === 'drop') {
      const drops = Object.values(await loadDrops()).flat();
      const drop = drops.find(d => d.name === name);
      if (drop) {
        selectResult({ type: 'drop', drop, score: 0 });
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

// Add this function at the top level of search.ts
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

// Add this function before updateResults
function renderLocationResult(location: Location & { type: string }, index: number, selectedIndex: number, allLocations: (Location & { type: string })[]): string {
  const isMultiLocation = Array.isArray(location.coordinates[0]);
  let result = '';

  if (isMultiLocation) {
    // Create parent result without index
    result = `
      <div class="search-result parent-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="location"
           data-name="${location.name}">
        <div class="search-result-icon">
          ${location.icon?.startsWith('fa-') 
            ? `<i class="${location.icon}" style="color: ${location.iconColor || '#FFFFFF'}"></i>`
            : `<img src="${location.icon}.svg" alt="">`}
        </div>
        <div class="search-result-content">
          <div class="result-name">${highlightText(location.name)}</div>
          ${location.description 
            ? `<div class="result-description">${highlightText(location.description)}</div>` 
            : ''}
        </div>
      </div>`;

    // Add all locations including the first one as child items
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
    // Single location rendering
    result = `
      <div class="search-result ${index === selectedIndex ? 'selected' : ''}" 
           data-type="location"
           data-name="${location.name}">
        <div class="search-result-icon">
          ${location.icon?.startsWith('fa-') 
            ? `<i class="${location.icon}" style="color: ${location.iconColor || '#FFFFFF'}"></i>`
            : `<img src="${location.icon}.svg" alt="">`}
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

function findNearestNamedLocation(coords: [number, number], locations: (Location & { type: string })[]): Location & { type: string } | null {
  // Filter for location type markers only (those in locations/location/*.yml)
  const locationMarkers = locations.filter(loc => loc.type === 'location');
  
  if (locationMarkers.length === 0) return null;

  return locationMarkers.reduce((nearest, loc) => {
    const locCoords = loc.coordinates as [number, number]; // Location markers are always single point
    const currentDist = Math.hypot(coords[0] - locCoords[0], coords[1] - locCoords[1]);
    
    const nearestCoords = nearest.coordinates as [number, number];
    const nearestDist = Math.hypot(coords[0] - nearestCoords[0], coords[1] - nearestCoords[1]);

    return currentDist < nearestDist ? loc : nearest;
  });
}