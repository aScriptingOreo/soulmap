import type { Location } from './types';
import * as L from 'leaflet';

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
        .slice(0, 8) // Show more results
        .map((result, index) => `
          <div class="search-result ${index === selectedIndex ? 'selected' : ''}" data-name="${result.location.name}">
            <div class="search-result-icon">
              ${result.location.icon?.startsWith('fa-') 
                ? `<i class="${result.location.icon}" style="color: ${result.location.iconColor || '#FFFFFF'}"></i>`
                : ''}
            </div>
            <div class="search-result-content">
              <div class="result-name">${result.location.name}</div>
              ${result.location.description 
                ? `<div class="result-description">${result.location.description}</div>` 
                : ''}
            </div>
            ${result.location.imgUrl 
              ? `<img class="search-result-image" src="${result.location.imgUrl}" alt="${result.location.name}">` 
              : ''}
          </div>
        `)
        .join('');
    } else {
      resultsContainer.innerHTML = '<div class="no-results">No locations found</div>';
    }
    resultsContainer.style.display = 'block';
  }

  function selectLocation(location: Location & { type: string }) {
    const coords = Array.isArray(location.coordinates[0]) 
      ? location.coordinates[0] as [number, number]
      : location.coordinates as [number, number];

    map.setView([coords[1], coords[0]], map.getZoom());

    // Update URL with location parameter
    const encodedLocation = encodeURIComponent(location.name);
    window.history.replaceState({}, '', `?location=${encodedLocation}`);

    // Find and trigger marker
    const marker = markers.find(m => {
      const pos = m.getLatLng();
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
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, maxIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          const selected = results[selectedIndex];
          const locationName = selected.getAttribute('data-name');
          const location = locations.find(l => l.name === locationName);
          if (location) {
            selectLocation(location);
          }
        }
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
      const location = locations.find(l => l.name === locationName);
      if (location) {
        selectLocation(location);
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