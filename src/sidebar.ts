import * as L from 'leaflet';
import type { Location } from './types';
import { generateLocationHash } from './utils';

export interface SidebarOptions {
  element: HTMLElement;
  locations: (Location & { type: string })[];
  map: L.Map;
  markers: L.Marker[];
}

interface CachedVisibilityState {
  version: string;
  markers: string[];
  categories: string[];
}

export class Sidebar {
  private element: HTMLElement;
  private locations: (Location & { type: string })[];
  private map: L.Map;
  private markers: L.Marker[];
  private titleEl!: HTMLElement;
  private descEl!: HTMLElement;
  private coordEl!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private imageModal!: HTMLElement;
  private modalImage!: HTMLImageElement;
  private modalTitle!: HTMLElement;
  private modalDescription!: HTMLElement;
  private closeButton!: HTMLElement;
  private locationDrawer!: HTMLElement;
  private visibleMarkers: Set<string> = new Set();
  private visibleCategories: Set<string> = new Set();
  private toggleButton!: HTMLButtonElement;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private readonly VISIBILITY_CACHE_KEY = 'soulmap_visibility_cache';

  constructor(options: SidebarOptions) {
    this.element = options.element;
    this.locations = options.locations;
    this.map = options.map;
    this.markers = options.markers;

    // Create and add toggle button immediately
    this.createToggleButton();
  }

  private createToggleButton(): void {
    this.toggleButton = document.createElement('button');
    this.toggleButton.id = 'sidebar-toggle';
    this.toggleButton.className = 'sidebar-toggle collapsed';
    
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = 'chevron_left';
    this.toggleButton.appendChild(icon);
    
    document.body.appendChild(this.toggleButton);
    
    // Initialize toggle functionality
    this.toggleButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.ensureInitialized();
        this.element.classList.toggle('collapsed');
        this.toggleButton.classList.toggle('collapsed');
    });

    // Add keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            this.toggleButton.click();
        }
    });

    // Make button visible immediately
    requestAnimationFrame(() => {
        this.toggleButton.classList.add('loaded');
    });
}

  // Add this new method
  private showSidebar(): void {
    this.element.classList.remove('collapsed');
    this.toggleButton.classList.remove('collapsed');
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }
    
    return this.initializationPromise;
  }

  private async initialize(): Promise<void> {
    // Initialize elements synchronously
    this.initializeElements();
    
    // Load cached visibility state if available
    await this.loadVisibilityState();
    
    // Initialize components asynchronously
    await this.initializeComponentsAsync();
    
    // Mark as initialized
    this.initialized = true;

    // Always show loaded state
    requestAnimationFrame(() => {
        this.element.classList.add('loaded');
        this.toggleButton.classList.add('loaded');
    });
}

// Helper method to find closest location
private findClosestLocation(coords: [number, number]): (Location & { type: string }) | undefined {
    let closest = this.locations[0];
    let minDist = Infinity;

    this.locations.forEach(location => {
        const locCoords = Array.isArray(location.coordinates[0]) 
            ? location.coordinates[0] 
            : location.coordinates as [number, number];
        
        const dist = Math.hypot(coords[0] - locCoords[0], coords[1] - locCoords[1]);
        if (dist < minDist) {
            minDist = dist;
            closest = location;
        }
    });

    return closest;
}

  private async loadVisibilityState(): Promise<void> {
    try {
      const cachedData = localStorage.getItem(this.VISIBILITY_CACHE_KEY);
      if (cachedData) {
        const state = JSON.parse(cachedData) as CachedVisibilityState;
        const versionModule = await import('./mapversion.yml');
        if (state.version === versionModule.default.version) {
          this.visibleMarkers = new Set(state.markers);
          this.visibleCategories = new Set(state.categories);
          return;
        }
      }
    } catch (error) {
      console.warn('Failed to load visibility state:', error);
    }
    
    // Default: make everything visible
    this.visibleMarkers = new Set(this.locations.map(l => l.name));
    this.visibleCategories = new Set(this.locations.map(l => l.type));
  }

  private async saveVisibilityState(): Promise<void> {
    try {
      const state: CachedVisibilityState = {
        version: (await import('./mapversion.yml')).default.version,
        markers: Array.from(this.visibleMarkers),
        categories: Array.from(this.visibleCategories)
      };
      localStorage.setItem(this.VISIBILITY_CACHE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to save visibility state:', error);
    }
  }

  private async initializeComponentsAsync(): Promise<void> {
    // Group locations by type first
    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) acc[location.type] = [];
      acc[location.type].push(location);
      return acc;
    }, {} as Record<string, (Location & { type: string })[]>);

    // Initialize handlers that don't depend on DOM creation
    this.initializeImageHandlers();

    // Create location drawer elements asynchronously in chunks
    const categoriesContainer = this.element.querySelector('.categories') as HTMLElement;
    const chunkSize = 10; // Process 10 categories at a time

    for (let i = 0; i < Object.entries(groupedLocations).length; i += chunkSize) {
      const chunk = Object.entries(groupedLocations).slice(i, i + chunkSize);
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          chunk.forEach(([category, items]) => {
            this.createCategorySection(category, items, categoriesContainer);
          });
          resolve();
        });
      });
    }

    // Initialize drawer toggle after all elements are created
    const drawerToggle = this.element.querySelector('#drawer-toggle') as HTMLElement;
    drawerToggle?.addEventListener('click', () => {
      this.locationDrawer.classList.toggle('drawer-collapsed');
    });
  }

  // Update this method to ensure initialization before updating content
  async updateContent(location: Location & { type: string }, x: number, y: number) {
    await this.ensureInitialized();
    this.titleEl.textContent = location.name;
    this.descEl.textContent = location.description || 'No description available';
    this.coordEl.textContent = `[${Math.round(x)}, ${Math.round(y)}]`;

    if (location.imgUrl) {
      this.imgEl.src = location.imgUrl;
      this.imgEl.style.display = 'block';
    } else {
      this.imgEl.style.display = 'none';
      this.imgEl.src = '';
    }

    // Show sidebar when updating content
    this.showSidebar();
  }

  // Initialize image modal handlers
  private initializeImageHandlers() {
    const closeModal = () => {
      this.imageModal.style.display = 'none';
    };

    this.imgEl.addEventListener('click', () => {
      if (this.imgEl.src) {
        this.modalImage.src = this.imgEl.src;
        this.modalTitle.textContent = this.titleEl.textContent || '';
        this.modalDescription.textContent = this.descEl.textContent || '';
        this.imageModal.style.display = 'flex';
      }
    });

    this.closeButton.addEventListener('click', closeModal);
    this.imageModal.addEventListener('click', (e) => {
      if (e.target === this.imageModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // Initialize location drawer
  private initializeLocationDrawer() {
    const categoriesContainer = this.element.querySelector('.categories') as HTMLElement;
    const drawerToggle = this.element.querySelector('#drawer-toggle') as HTMLElement;

    // Group locations by type
    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) {
        acc[location.type] = [];
      }
      acc[location.type].push(location);
      return acc;
    }, {} as { [key: string]: (Location & { type: string })[] });

    // Create category sections
    Object.entries(groupedLocations).forEach(([category, items]) => {
      this.createCategorySection(category, items, categoriesContainer);
    });

    // Toggle drawer
    drawerToggle.addEventListener('click', () => {
      this.locationDrawer.classList.toggle('drawer-collapsed');
    });
  }

  // Create category section
  private createCategorySection(category: string, items: (Location & { type: string })[], container: HTMLElement) {
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    
    const categoryHeader = document.createElement('div');
    categoryHeader.className = 'category-header';
    
    const titleSpan = document.createElement('span');
    titleSpan.textContent = category.charAt(0).toUpperCase() + category.slice(1);
    
    const visibilityToggle = document.createElement('span');
    visibilityToggle.className = 'material-icons visibility-toggle';
    visibilityToggle.textContent = 'visibility';
    
    const chevronIcon = document.createElement('i');
    chevronIcon.className = 'fa-solid fa-chevron-down';
    
    categoryHeader.appendChild(titleSpan);
    categoryHeader.appendChild(visibilityToggle);
    categoryHeader.appendChild(chevronIcon);

    const categoryContent = document.createElement('div');
    categoryContent.className = 'category-content';

    // Add category visibility toggle
    visibilityToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCategoryVisibility(category, items, visibilityToggle);
    });

    items.forEach((item) => {
      this.createLocationItem(item, categoryContent);
    });

    // Existing category click handler...
    categoryHeader.addEventListener('click', () => {
      categoryContent.classList.toggle('open');
      chevronIcon.classList.toggle('fa-chevron-up');
    });

    categoryDiv.appendChild(categoryHeader);
    categoryDiv.appendChild(categoryContent);
    container.appendChild(categoryDiv);
  }

  // Create location item
  private createLocationItem(item: Location & { type: string }, container: HTMLElement) {
    const hasMultipleCoords = Array.isArray(item.coordinates[0]);

    if (hasMultipleCoords) {
      this.createMultiLocationItem(item, container);
    } else {
      this.createSingleLocationItem(item, container);
    }
  }

  // Create multi-location item
  private createMultiLocationItem(item: Location & { type: string }, container: HTMLElement) {
    const parentDiv = document.createElement('div');
    parentDiv.className = 'category';
    parentDiv.setAttribute('data-name', item.name);
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'category-header';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name;
    
    const visibilityToggle = document.createElement('span');
    visibilityToggle.className = 'material-icons visibility-toggle';
    visibilityToggle.textContent = 'visibility';
    
    const chevronIcon = document.createElement('i');
    chevronIcon.className = 'fa-solid fa-chevron-down';
    
    headerDiv.appendChild(nameSpan); // Fix: was using titleSpan instead of nameSpan
    headerDiv.appendChild(visibilityToggle);
    headerDiv.appendChild(chevronIcon);

    const dropdownContent = document.createElement('div');
    dropdownContent.className = 'category-content';
    
    (item.coordinates as [number, number][]).forEach((coords, index) => {
        const locationOption = document.createElement('div');
        locationOption.className = 'location-item';
        
        const coordSpan = document.createElement('span');
        coordSpan.className = 'location-name';
        coordSpan.textContent = `#${index + 1}`;
        
        const coordToggle = document.createElement('span');
        coordToggle.className = 'material-icons visibilityz-toggle';
        coordToggle.textContent = 'visibility';
        
        locationOption.appendChild(coordSpan);
        locationOption.appendChild(coordToggle);
        
        coordSpan.addEventListener('click', () => {
            this.handleLocationClick(coords, item);
        });
        
        coordToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const markerKey = `${item.name}-${index}`;
            this.toggleMarkerVisibility(markerKey, coordToggle, coords);
        });
        
        dropdownContent.appendChild(locationOption);
    });

    visibilityToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMultiMarkerVisibility(item, visibilityToggle);
    });

    headerDiv.addEventListener('click', () => {
        dropdownContent.classList.toggle('open');
        chevronIcon.classList.toggle('fa-chevron-up');
    });

    parentDiv.appendChild(headerDiv);
    parentDiv.appendChild(dropdownContent);
    container.appendChild(parentDiv);
}

  // Create single location item
  private createSingleLocationItem(item: Location & { type: string }, container: HTMLElement) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'location-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'location-name';
    nameSpan.textContent = item.name;
    
    const visibilityToggle = document.createElement('span');
    visibilityToggle.className = 'material-icons visibility-toggle';
    visibilityToggle.textContent = 'visibility';
    
    itemDiv.appendChild(nameSpan);
    itemDiv.appendChild(visibilityToggle);

    nameSpan.addEventListener('click', () => {
      const coords = item.coordinates as [number, number];
      this.handleLocationClick(coords, item);
    });

    visibilityToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMarkerVisibility(item.name, visibilityToggle);
    });

    container.appendChild(itemDiv);
  }

  // Handle location click
  private handleLocationClick(coords: [number, number], item: Location & { type: string }) {
    this.map.setView([coords[1], coords[0]], this.map.getZoom());

    const marker = this.markers.find(m => {
        const pos = m.getLatLng();
        return pos.lat === coords[1] && pos.lng === coords[0];
    });

    if (marker) {
        document.querySelectorAll('.custom-location-icon.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        marker.getElement()?.classList.add('selected');
        marker.fire('click');

        // Get marker index for multi-location items
        const markerContent = marker.getTooltip()?.getContent() as string;
        const markerIndex = markerContent.includes('#') ? 
            parseInt(markerContent.split('#')[1]) - 1 : 
            undefined;

        // Update URL with location hash and index if applicable
        const locationHash = generateLocationHash(item.name);
        const urlParams = markerIndex !== undefined ? 
            `?loc=${locationHash}&index=${markerIndex}` : 
            `?loc=${locationHash}`;
            
        window.history.replaceState({}, '', urlParams);
    }
}

  private async toggleMarkerVisibility(locationName: string, toggleElement: HTMLElement): Promise<void> {
    console.log('Toggling visibility for:', locationName);
    const isVisible = this.visibleMarkers.has(locationName);
    
    this.markers.forEach(marker => {
        const markerElement = marker.getElement();
        if (!markerElement) return;
        
        const markerLocation = markerElement.getAttribute('data-location');
        if (markerLocation === locationName) {
            if (isVisible) {
                markerElement.style.display = 'none';
                this.visibleMarkers.delete(locationName);
                toggleElement.classList.add('hidden');
            } else {
                markerElement.style.display = '';
                this.visibleMarkers.add(locationName);
                toggleElement.classList.remove('hidden');
            }
        }
    });

    // Update category toggle state
    this.updateCategoryVisibility(toggleElement);
    this.saveVisibilityState();
}

private async toggleCategoryVisibility(category: string, items: (Location & { type: string })[], toggle: HTMLElement): Promise<void> {
    const isVisible = this.visibleCategories.has(category);
    
    if (isVisible) {
        // Hide category and all its items
        this.visibleCategories.delete(category);
        toggle.textContent = 'visibility_off';
        toggle.classList.add('hidden');
        
        // Update all visibility toggles in this category
        const categoryElement = toggle.closest('.category');
        const allToggles = categoryElement?.querySelectorAll('.visibility-toggle');
        allToggles?.forEach(t => {
            (t as HTMLElement).textContent = 'visibility_off';
            t.classList.add('hidden');
        });

        // Remove all markers in this category from visible set
        items.forEach(item => {
            this.visibleMarkers.delete(item.name);
            if (Array.isArray(item.coordinates[0])) {
                (item.coordinates as [number, number][]).forEach((_, index) => {
                    this.visibleMarkers.delete(`${item.name}-${index}`);
                });
            }
            
            // Update markers visibility
            this.markers.forEach(marker => {
                const markerName = marker.getTooltip()?.getContent().split('#')[0].trim();
                if (markerName === item.name) {
                    const element = marker.getElement();
                    if (element) {
                        element.style.display = 'none';
                    }
                }
            });
        });
    } else {
        // Show category and all its items
        this.visibleCategories.add(category);
        toggle.textContent = 'visibility';
        toggle.classList.remove('hidden');
        
        // Update all visibility toggles in this category
        const categoryElement = toggle.closest('.category');
        const allToggles = categoryElement?.querySelectorAll('.visibility-toggle');
        allToggles?.forEach(t => {
            (t as HTMLElement).textContent = 'visibility';
            t.classList.remove('hidden');
        });

        // Add all markers in this category to visible set
        items.forEach(item => {
            this.visibleMarkers.add(item.name);
            if (Array.isArray(item.coordinates[0])) {
                (item.coordinates as [number, number][]).forEach((_, index) => {
                    this.visibleMarkers.add(`${item.name}-${index}`);
                });
            }
            
            // Update markers visibility
            this.markers.forEach(marker => {
                const markerName = marker.getTooltip()?.getContent().split('#')[0].trim();
                if (markerName === item.name) {
                    const element = marker.getElement();
                    if (element) {
                        element.style.display = '';
                    }
                }
            });
        });
    }
    this.saveVisibilityState();
}

private async toggleMultiMarkerVisibility(item: Location & { type: string }, toggle: HTMLElement): Promise<void> {
    const isVisible = this.visibleMarkers.has(item.name);
    const coordinates = item.coordinates as [number, number][];
    
    if (isVisible) {
        // Hide main item and all child markers
        this.visibleMarkers.delete(item.name);
        toggle.textContent = 'visibility_off';
        toggle.classList.add('hidden');
        
        // Update child toggles
        const itemElement = toggle.closest('[data-name]');
        const childToggles = itemElement?.querySelectorAll('.location-item .visibility-toggle');
        childToggles?.forEach(t => {
            (t as HTMLElement).textContent = 'visibility_off';
            t.classList.add('hidden');
        });
        
        // Remove individual coordinate markers from visible set
        coordinates.forEach((_, index) => {
            this.visibleMarkers.delete(`${item.name}-${index}`);
        });
        
        // Update marker visibility
        this.markers.forEach(marker => {
            const markerName = marker.getTooltip()?.getContent().split('#')[0].trim();
            if (markerName === item.name) {
                const element = marker.getElement();
                if (element) {
                    element.style.display = 'none';
                }
            }
        });
    } else {
        // Show main item and all child markers
        this.visibleMarkers.add(item.name);
        toggle.textContent = 'visibility';
        toggle.classList.remove('hidden');
        
        // Update child toggles
        const itemElement = toggle.closest('[data-name]');
        const childToggles = itemElement?.querySelectorAll('.location-item .visibility-toggle');
        childToggles?.forEach(t => {
            (t as HTMLElement).textContent = 'visibility';
            t.classList.remove('hidden');
        });
        
        // Add individual coordinate markers to visible set
        coordinates.forEach((_, index) => {
            this.visibleMarkers.add(`${item.name}-${index}`);
        });
        
        // Update marker visibility
        this.markers.forEach(marker => {
            const markerName = marker.getTooltip()?.getContent().split('#')[0].trim();
            if (markerName === item.name) {
                const element = marker.getElement();
                if (element) {
                    element.style.display = '';
                }
            }
        });
    }
    this.saveVisibilityState();
}

// private initializeSidebarToggle() {
//   if (!this.toggleButton) return;
// 
//   const toggleSidebar = () => {
//     this.element.classList.toggle('collapsed');
//     this.toggleButton.classList.toggle('collapsed');
//   };
// 
//   // Click handler with console log for debugging
//   this.toggleButton.addEventListener('click', (e) => {
//     e.stopPropagation(); // Prevent event bubbling
//     console.log('Toggle button clicked'); // Debug log
//     toggleSidebar();
//   });
// 
//   // Keyboard shortcut (Ctrl + B)
//   document.addEventListener('keydown', (e) => {
//     if (e.ctrlKey && e.key === 'b') {
//       e.preventDefault();
//       toggleSidebar();
//     }
//   });
// }

private initializeElements(): void {
  // Get references to DOM elements
  this.titleEl = this.element.querySelector('.location-title') as HTMLElement;
  this.descEl = this.element.querySelector('.location-description') as HTMLElement;
  this.coordEl = this.element.querySelector('.coordinates-display') as HTMLElement;
  this.imgEl = this.element.querySelector('#sidebar-image') as HTMLImageElement;
  this.imageModal = document.querySelector('#image-modal') as HTMLElement;
  this.modalImage = document.querySelector('#modal-image') as HTMLImageElement;
  this.modalTitle = document.querySelector('.modal-title') as HTMLElement;
  this.modalDescription = document.querySelector('.modal-description') as HTMLElement;
  this.closeButton = document.querySelector('.close-button') as HTMLElement;
  this.locationDrawer = this.element.querySelector('.location-drawer') as HTMLElement;
}
}