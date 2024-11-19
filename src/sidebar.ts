import * as L from 'leaflet';
import type { Location } from './types';

export interface SidebarOptions {
  element: HTMLElement;
  locations: (Location & { type: string })[];
  map: L.Map;
  markers: L.Marker[];
}

export class Sidebar {
  private element: HTMLElement;
  private locations: (Location & { type: string })[];
  private map: L.Map;
  private markers: L.Marker[];
  private titleEl: HTMLElement;
  private descEl: HTMLElement;
  private coordEl: HTMLElement;
  private imgEl: HTMLImageElement;
  private imageModal: HTMLElement;
  private modalImage: HTMLImageElement;
  private modalTitle: HTMLElement;
  private modalDescription: HTMLElement;
  private closeButton: HTMLElement;
  private locationDrawer: HTMLElement;

  constructor(options: SidebarOptions) {
    this.element = options.element;
    this.locations = options.locations;
    this.map = options.map;
    this.markers = options.markers;

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

    this.initializeImageHandlers();
    this.initializeLocationDrawer();
  }

  // Update sidebar content
  updateContent(location: Location & { type: string }, x: number, y: number) {
    this.titleEl.textContent = location.name;
    this.descEl.textContent = location.description || 'No description available';
    this.coordEl.textContent = `[${Math.round(x)}, ${Math.round(y)}]`; // Changed format to match YAML

    if (location.imgUrl) {
      this.imgEl.src = location.imgUrl;
      this.imgEl.style.display = 'block';
    } else {
      this.imgEl.style.display = 'none';
      this.imgEl.src = '';
    }
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
    categoryHeader.innerHTML = `
      <span>${category.charAt(0).toUpperCase() + category.slice(1)}</span>
      <i class="fa-solid fa-chevron-down"></i>
    `;

    const categoryContent = document.createElement('div');
    categoryContent.className = 'category-content';

    items.forEach((item) => {
      this.createLocationItem(item, categoryContent);
    });

    categoryHeader.addEventListener('click', () => {
      categoryContent.classList.toggle('open');
      categoryHeader.querySelector('i')?.classList.toggle('fa-chevron-up');
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
    parentDiv.className = 'location-item-parent';
    parentDiv.setAttribute('data-name', item.name);
    parentDiv.innerHTML = `
      <div class="location-header">
        <span>${item.name}</span>
        <i class="fa-solid fa-chevron-down"></i>
      </div>
    `;

    const dropdownContent = document.createElement('div');
    dropdownContent.className = 'location-dropdown';
    dropdownContent.style.display = 'none';
    dropdownContent.style.paddingLeft = '20px';

    (item.coordinates as [number, number][]).forEach((coords, index) => {
      const locationOption = document.createElement('div');
      locationOption.className = 'location-option';
      locationOption.textContent = `#${index + 1}`;
      locationOption.style.padding = '5px 0';
      locationOption.style.cursor = 'pointer';

      locationOption.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleLocationClick(coords, item);
      });

      dropdownContent.appendChild(locationOption);
    });

    parentDiv.querySelector('.location-header')?.addEventListener('click', () => {
      const isOpen = dropdownContent.style.display === 'block';
      dropdownContent.style.display = isOpen ? 'none' : 'block';
      parentDiv.querySelector('i')?.classList.toggle('fa-chevron-up');
    });

    parentDiv.appendChild(dropdownContent);
    container.appendChild(parentDiv);
  }

  // Create single location item
  private createSingleLocationItem(item: Location & { type: string }, container: HTMLElement) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'location-item';
    itemDiv.setAttribute('data-name', item.name);
    itemDiv.textContent = item.name;

    itemDiv.addEventListener('click', () => {
      const coords = item.coordinates as [number, number];
      this.handleLocationClick(coords, item);
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
    }
  }
}