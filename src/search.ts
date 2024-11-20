import type { Location } from './types';
import * as L from 'leaflet';

interface SearchResult {
  location: Location & { type: string };
  score: number;
}

export function initializeSearch(locations: (Location & { type: string })[], map: L.Map, markers: L.Marker[]) {
  // Add search bar to the DOM
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';
  searchContainer.innerHTML = `
    <input type="text" id="location-search" placeholder="Search locations...">
    <div class="search-results"></div>
  `;
  document.querySelector('#map')?.appendChild(searchContainer);

  const searchInput = document.getElementById('location-search') as HTMLInputElement;
  const resultsContainer = document.querySelector('.search-results') as HTMLDivElement;

  // Search functionality
  function searchLocations(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const normalizedQuery = query.toLowerCase();

    locations.forEach(location => {
      let score = 0;
      const name = location.name.toLowerCase();
      const description = (location.description || '').toLowerCase();

      // Exact matches get highest score
      if (name === normalizedQuery) score += 100;
      if (description === normalizedQuery) score += 50;

      // Partial matches
      if (name.includes(normalizedQuery)) score += 75;
      if (description.includes(normalizedQuery)) score += 25;

      // Word boundary matches
      if (name.split(' ').some(word => word.startsWith(normalizedQuery))) score += 60;
      if (description.split(' ').some(word => word.startsWith(normalizedQuery))) score += 20;

      if (score > 0) {
        results.push({ location, score });
      }
    });

    return results.sort((a, b) => b.score - a.score);
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

      // Expand corresponding category and item in the locations list
      const categoryContent = document.querySelector(`.category:has([data-name="${location.name}"]) .category-content`);
      if (categoryContent) {
        categoryContent.classList.add('open');
        
        // If item has multiple coordinates, expand its dropdown
        const locationItem = document.querySelector(`[data-name="${location.name}"]`);
        if (locationItem && Array.isArray(location.coordinates[0])) {
          const dropdownContent = locationItem.querySelector('.location-dropdown');
          if (dropdownContent instanceof HTMLElement) {
            dropdownContent.style.display = 'block';
            locationItem.querySelector('i')?.classList.add('fa-chevron-up');
          }
        }
      }
    }

    // Clear search
    searchInput.value = '';
    resultsContainer.style.display = 'none';
  }

  // Event listeners
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      resultsContainer.style.display = 'none';
      return;
    }

    const results = searchLocations(query);
    if (results.length > 0) {
      resultsContainer.innerHTML = results
        .slice(0, 5) // Limit to top 5 results
        .map(result => `
          <div class="search-result" data-name="${result.location.name}">
            <div class="result-name">${result.location.name}</div>
            ${result.location.description ? 
              `<div class="result-description">${result.location.description}</div>` : 
              ''}
          </div>
        `)
        .join('');
      resultsContainer.style.display = 'block';
    } else {
      resultsContainer.innerHTML = '<div class="no-results">No locations found</div>';
      resultsContainer.style.display = 'block';
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstResult = resultsContainer.querySelector('.search-result');
      if (firstResult) {
        const locationName = firstResult.getAttribute('data-name');
        const location = locations.find(l => l.name === locationName);
        if (location) {
          selectLocation(location);
        }
      }
    }
  });

  resultsContainer.addEventListener('click', (e) => {
    const resultEl = (e.target as HTMLElement).closest('.search-result');
    if (resultEl) {
      const locationName = resultEl.getAttribute('data-name');
      const location = locations.find(l => l.name === locationName);
      if (location) {
        selectLocation(location);
      }
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target as Node)) {
      resultsContainer.style.display = 'none';
    }
  });
}