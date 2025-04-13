import * as L from "leaflet";
import type { Location } from "./types";
import { generateLocationHash, getRelativeDirection, formatLastUpdated } from "./utils";
import { CustomMarkerService } from "./services/customMarkers";
import { getMap } from "./map"; // Import the helper function
import { forceMarkerRedraw } from './services/visibilityMiddleware';
import { LOCATION_UPDATE_EVENT } from './loader';

function getIconUrl(iconPath: string): string {
  // Check if it's a full URL (starts with http or https)
  if (/^(https?:\/\/)/.test(iconPath)) {
    return iconPath;
  }

  // Ensure we have a consistent base URL for all icons
  // Make sure the path starts with a slash
  const normalizedPath = iconPath.startsWith('/') ? iconPath : `/${iconPath}`;

  // Remove any .svg extension if it's there - we'll add it consistently below
  const pathWithoutExtension = normalizedPath.replace(/\.svg$/, '');

  // Add cache busting parameter
  const cacheBuster = new Date().getMonth(); // Simple cache buster that changes monthly

  // Return the full path with extension and optional cache buster
  return `${pathWithoutExtension}.svg?v=${cacheBuster}`;
}

export interface SidebarOptions {
  element: HTMLElement;
  locations: (Location & { type: string })[];
  map?: L.Map; // Map is now optional
  markers: L.Marker[];
  visibilityMiddleware?: {
    isMarkerVisible: (markerId: string, category?: string) => boolean;
    setMarkerVisibility: (markerId: string, visible: boolean) => Promise<void>;
    setCategoryVisibility: (category: string, visible: boolean) => Promise<void>;
    getHiddenMarkers: () => Set<string>;
    getHiddenCategories: () => Set<string>;
  };
}

export class Sidebar {
  private element: HTMLElement;
  private locations: (Location & { type: string })[];
  private map: L.Map | null; // Map can be null
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
  private customMarkerService: CustomMarkerService;
  private hasCustomCategory: boolean = false;
  private locationContent!: HTMLElement;
  private visibilityMiddleware: SidebarOptions['visibilityMiddleware'];
  private currentMediaIndex: number = 0;
  private mediaUrls: string[] = [];

  constructor(options: SidebarOptions) {
    this.element = options.element;
    this.locations = options.locations;
    this.map = options.map || null; // Handle potentially missing map
    this.markers = options.markers;
    this.customMarkerService = new CustomMarkerService();
    
    // Ensure middleware is defined with fallback functions
    this.visibilityMiddleware = options.visibilityMiddleware || {
        isMarkerVisible: () => true,
        setMarkerVisibility: async () => {},
        setCategoryVisibility: async () => {},
        getHiddenMarkers: () => new Set<string>(),
        getHiddenCategories: () => new Set<string>()
    };

    // Initialize visibility state from middleware if available
    const hiddenMarkers = this.visibilityMiddleware?.getHiddenMarkers() || new Set<string>();
    this.visibleMarkers = new Set(
        this.locations.flatMap(loc => {
            if (Array.isArray(loc.coordinates[0])) {
                const multiCoords = loc.coordinates as [number, number][];
                return multiCoords.map((_, idx) => `${loc.name}-${idx}`);
            }
            return [loc.name];
        }).filter(id => !hiddenMarkers.has(id))
    );

    const hiddenCategories = this.visibilityMiddleware?.getHiddenCategories() || new Set<string>();
    this.visibleCategories = new Set(
        this.locations.map(loc => loc.type).filter(cat => !hiddenCategories.has(cat))
    );

    // Create and add toggle button immediately
    this.createToggleButton();

    // Add listener for empty custom markers
    window.addEventListener("customMarkersEmpty", () => {
      const customCategory = this.element.querySelector(
        '[data-category="custom"]'
      );
      if (customCategory) {
        customCategory.remove();
        this.hasCustomCategory = false;
      }
    });
    
    // Listen for location updates
    document.addEventListener(LOCATION_UPDATE_EVENT, (event: CustomEvent) => {
      const updatedLocations = event.detail.locations as (Location & { type: string })[];
      this.updateLocations(updatedLocations);
    });
    
    // Start initialization right away
    this.initialize();
  }

  private createToggleButton(): void {
    this.toggleButton = document.createElement("button");
    this.toggleButton.id = "sidebar-toggle";
    this.toggleButton.className = "sidebar-toggle collapsed";
    this.element.classList.add("collapsed");
    const icon = document.createElement("span");
    icon.className = "material-icons";
    icon.textContent = "chevron_left";
    this.toggleButton.appendChild(icon);
    document.body.appendChild(this.toggleButton);

    this.toggleButton.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.ensureInitialized();
      const isCollapsed = this.element.classList.contains("collapsed");
      if (isCollapsed) {
        this.element.classList.remove("collapsed");
        this.toggleButton.classList.remove("collapsed");
        // Hide search bar on small screens when sidebar is open
        if (this.isSmallScreenOrVertical()) {
          const searchContainer = document.querySelector('.search-container');
          if (searchContainer) {
            searchContainer.classList.add('hidden-mobile');
          }
        }
      } else {
        this.element.classList.add("collapsed");
        this.toggleButton.classList.add("collapsed");
        window.history.replaceState({}, "", window.location.pathname);
        document
          .querySelectorAll(".custom-location-icon.selected")
          .forEach((el) => {
            el.classList.remove("selected");
          });
        // Show search bar again on small screens when sidebar is closed
        if (this.isSmallScreenOrVertical()) {
          const searchContainer = document.querySelector('.search-container');
          if (searchContainer) {
            searchContainer.classList.remove('hidden-mobile');
          }
        }
      }
    });

    // Add resize listener to handle orientation changes
    window.addEventListener('resize', this.handleResize.bind(this));
    requestAnimationFrame(() => {
      this.toggleButton.classList.add("loaded");
      this.element.classList.add("loaded");
      // Initial check for search visibility based on sidebar state
      if (this.isSmallScreenOrVertical() && !this.element.classList.contains('collapsed')) {
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
          searchContainer.classList.add('hidden-mobile');
        }
      }
    });
  }

  // Helper method to check if we're on a small screen or in vertical orientation
  private isSmallScreenOrVertical(): boolean {
    return window.innerWidth < 768 || (window.innerWidth / window.innerHeight < 1);
  }

  // Handle window resize events
  private handleResize(): void {
    const isSmall = this.isSmallScreenOrVertical();
    const sidebarOpen = !this.element.classList.contains('collapsed');
    // Toggle search visibility
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      if (isSmall && sidebarOpen) {
        searchContainer.classList.add('hidden-mobile');
      } else {
        searchContainer.classList.remove('hidden-mobile');
      }
    }
  }

  private showSidebar(): void {
    this.element.classList.remove("collapsed");
    this.toggleButton.classList.remove("collapsed");
    if (!this.element.classList.contains("loaded")) {
      this.element.classList.add("loaded");
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }
    return this.initializationPromise;
  }

  private async initialize(): Promise<void> {
    // Initialize elements ASAP
    try {
      // Add CSS styles for media navigation
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        .media-navigation {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 10px;
          padding: 5px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 5px;
        }
        
        .sidebar-media-nav {
          margin: 5px 0;
        }
        
        .nav-button {
          background: rgba(0, 0, 0, 0.5);
          color: white;
          border: none;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .nav-button:hover {
          background: rgba(0, 0, 0, 0.8);
        }
        
        .media-counter {
          color: white;
          font-size: 14px;
        }
        
        #image-modal .media-navigation {
          position: absolute;
          bottom: 10px;
          left: 0;
          right: 0;
          width: 200px;
          margin: 0 auto;
          background: rgba(0, 0, 0, 0.6);
        }
      `;
      document.head.appendChild(styleEl);
      
      this.initializeElements();
      this.createTabInterface();
      await this.loadVisibilityState();
      await this.initializeComponentsAsync();
      this.initialized = true;

      requestAnimationFrame(() => {
        this.element.classList.add("loaded");
        this.toggleButton.classList.add("loaded");
      });
    } catch (error) {
      console.error("Failed to initialize sidebar:", error);
    }
  }

  private async loadVisibilityState(): Promise<void> {
    if (this.visibilityMiddleware) {
      const hiddenMarkers = this.visibilityMiddleware.getHiddenMarkers();
      const hiddenCategories = this.visibilityMiddleware.getHiddenCategories();

      this.visibleMarkers = new Set(
        this.locations.flatMap(loc => {
          if (Array.isArray(loc.coordinates[0])) {
            const multiCoords = loc.coordinates as [number, number][];
            return multiCoords.map((_, idx) => `${loc.name}-${idx}`);
          }
          return [loc.name];
        }).filter(id => !hiddenMarkers.has(id))
      );

      this.visibleCategories = new Set(
        this.locations.map(loc => loc.type).filter(cat => !hiddenCategories.has(cat))
      );
    } else {
      try {
        const markersJson = localStorage.getItem("soulmap_visible_markers");
        const categoriesJson = localStorage.getItem("soulmap_visible_categories");

        const initialVisibleMarkers = new Set(this.locations.map((l) => l.name));
        if (markersJson) {
          const savedMarkers = new Set(JSON.parse(markersJson));
          this.visibleMarkers = savedMarkers.size > 0 ? savedMarkers : initialVisibleMarkers;
        } else {
          this.visibleMarkers = initialVisibleMarkers;
        }

        const initialVisibleCategories = new Set(this.locations.map((l) => l.type));
        if (categoriesJson) {
          const savedCategories = new Set(JSON.parse(categoriesJson));
          this.visibleCategories = savedCategories.size > 0 ? savedCategories : initialVisibleCategories;
        } else {
          this.visibleCategories = initialVisibleCategories;
        }

        this.saveVisibilityState();
      } catch (error) {
        console.error("Error loading visibility state:", error);
        this.visibleMarkers = new Set(this.locations.map((l) => l.name));
        this.visibleCategories = new Set(this.locations.map((l) => l.type));
      }
    }
  }

  private saveVisibilityState(): void {
    if (this.visibilityMiddleware) {
      return;
    } else {
      try {
        localStorage.setItem(
          "soulmap_visible_markers",
          JSON.stringify(Array.from(this.visibleMarkers))
        );
        localStorage.setItem(
          "soulmap_visible_categories",
          JSON.stringify(Array.from(this.visibleCategories))
        );
      } catch (error) {
        console.error("Error saving visibility state:", error);
      }
    }
  }

  private async initializeComponentsAsync(): Promise<void> {
    const locationsList = document.createElement("div");
    locationsList.className = "locations-list drawer-content";

    const categoriesContainer = document.createElement("div");
    categoriesContainer.className = "categories";
    locationsList.appendChild(categoriesContainer);

    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) acc[location.type] = [];
      acc[location.type].push(location);
      return acc;
    }, {} as Record<string, (Location & { type: string })[]>);

    this.initializeImageHandlers();

    const chunkSize = 10;
    for (
      let i = 0;
      i < Object.entries(groupedLocations).length;
      i += chunkSize
    ) {
      const chunk = Object.entries(groupedLocations).slice(i, i + chunkSize);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          chunk.forEach(([category, items]) => {
            this.createCategorySection(category, items, categoriesContainer);
          });
          resolve();
        });
      });
    }

    const drawerHeader = document.createElement("div");
    drawerHeader.className = "drawer-header";
    drawerHeader.id = "drawer-toggle";
    drawerHeader.innerHTML = `<span>Locations List</span>`;

    const drawerContainer = document.createElement("div");
    drawerContainer.className = "location-drawer";
    drawerContainer.appendChild(drawerHeader);
    drawerContainer.appendChild(locationsList);
    this.element.appendChild(drawerContainer);
    this.locationDrawer = drawerContainer;
  }

  private getCoordinateSpecificProperties(location: Location & { type: string }, coordIndex?: number): Location & { type: string } {
    // If no coordinates or invalid coordinates, return the original location
    if (!location.coordinates || !Array.isArray(location.coordinates)) {
      return location;
    }
  
    // Default coordIndex to 0 if undefined
    const index = coordIndex !== undefined ? coordIndex : 0;
    
    // Handle the case of a simple coordinate pair [x, y]
    if (location.coordinates.length === 2 && typeof location.coordinates[0] === 'number' && typeof location.coordinates[1] === 'number') {
      return location;
    }
    
    // Check if we have complex coordinate objects with nested properties
    if (location.coordinates.length > 0 && typeof location.coordinates[0] === 'object') {
      // Check if this is a complex structure like in tuvalkane.yml where each item has a 'coordinates' property
      const firstItem = location.coordinates[0] as any;
      
      // Handle the case where each item in coordinates array has its own coordinates and properties
      if (firstItem.coordinates && Array.isArray(firstItem.coordinates)) {
        console.log(`Complex coordinates - accessing index ${index} of ${location.coordinates.length} items`);
        
        // If we have a valid index, use that specific item's properties
        if (index >= 0 && index < location.coordinates.length) {
          const coordItem = location.coordinates[index] as any;
          
          // Extract the actual coordinates from the nested structure
          const nestedCoords = coordItem.coordinates;
          if (Array.isArray(nestedCoords) && nestedCoords.length === 2 &&
              typeof nestedCoords[0] === 'number' && typeof nestedCoords[1] === 'number') {
            
            // Create a merged object with both location and point-specific properties
            return {
              ...location,
              ...coordItem,
              // Keep the original name and type
              name: location.name,
              type: location.type,
              // Store the exact coordinates for this point - CRITICAL FIX
              _exactCoordinates: nestedCoords
            };
          }
        }
      }
    }
    
    // For standard multi-coordinates like [[x1,y1], [x2,y2]] or fallback cases
    return location;
  }
  
  // Add tracking for current location in complex coordinates
  private currentComplexCoordinateInfo: {
    locationName: string;
    currentIndex: number;
    totalPoints: number;
  } | null = null;

  private parseMarkdownLinks(text: string): string {
    if (!text) return '';
    
    // First handle standard Markdown links: [text](url)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let processedText = text.replace(linkPattern, (match, linkText, url) => {
      // Handle both absolute and relative URLs
      let fullUrl = url;
      
      // If it's a relative URL (starts with /)
      if (url.startsWith('/')) {
        fullUrl = `${window.location.origin}${url}`;
      } 
      // If it's a query parameter only URL (starts with ?)
      else if (url.startsWith('?')) {
        fullUrl = `${window.location.origin}${window.location.pathname}${url}`;
      }
      // If it doesn't have a protocol, add the current origin
      else if (!url.includes('://')) {
        fullUrl = `${window.location.origin}/${url}`;
      }
      
      // Create HTML link that uses our internal navigation
      return `<a href="${fullUrl}" class="internal-link">${linkText}</a>`;
    });
    
    // Then look for coordinate patterns like [x, y] that aren't already links
    // Patterns to match: [x, y], [x,y], (x, y), (x,y), x, y
    const coordPatterns = [
      /\[(\d+)\s*,\s*(\d+)\]/g,  // [x, y] or [x,y]
      /\((\d+)\s*,\s*(\d+)\)/g,  // (x, y) or (x,y)
      /(\d{4})\s*,\s*(\d{4})/g   // x, y (4+ digits to avoid false positives)
    ];
    
    // Process each pattern
    coordPatterns.forEach(pattern => {
      processedText = processedText.replace(pattern, (match, x, y) => {
        // Skip if this is already wrapped in an <a> tag
        if (this.isInsideLink(match, processedText)) return match;
        
        const numX = parseInt(x, 10);
        const numY = parseInt(y, 10);
        
        if (isNaN(numX) || isNaN(numY)) return match;
        
        // Check if there's a marker near these coordinates - with improved context handling
        const isCurrentLocation = numX === this.lastVisitedCoordinate?.[0] && 
                              numY === this.lastVisitedCoordinate?.[1];
        
        if (isCurrentLocation) {
          // This coordinate is the current location - style it differently
          return `<span class="current-coordinate" title="Current coordinates">${match}</span>`;
        }
        
        // For all other coordinates, create a link that will navigate there
        const url = `?coord=${numX},${numY}`;
        return `<a href="${url}" class="coordinate-link" title="Go to coordinates [${numX}, ${numY}]" data-x="${numX}" data-y="${numY}">${match}</a>`;
      });
    });
    
    return processedText;
  }
  
  // Helper to check if a text match is already inside an HTML link
  private isInsideLink(match: string, fullText: string): boolean {
    const matchIndex = fullText.indexOf(match);
    if (matchIndex === -1) return false;
    
    // Look for an opening <a tag before the match
    const textBeforeMatch = fullText.substring(0, matchIndex);
    const lastOpeningTag = textBeforeMatch.lastIndexOf('<a');
    if (lastOpeningTag === -1) return false;
    
    // Check if there's a closing </a> between the opening tag and the match
    const textBetweenTagAndMatch = textBeforeMatch.substring(lastOpeningTag);
    return !textBetweenTagAndMatch.includes('</a>');
  }
  
  // Find a marker near the given coordinates (within ±5px)
  private findNearbyMarker(coords: [number, number]): L.Marker | null {
    // Use the stored markers or get them from the global map
    const markersToCheck = this.markers.length ? this.markers : (window.markersGlobal || []);
    
    return markersToCheck.find(marker => {
      const pos = marker.getLatLng();
      // Calculate distance - use ±5 pixel tolerance
      return Math.abs(pos.lng - coords[0]) <= 5 && Math.abs(pos.lat - coords[1]) <= 5;
    }) || null;
  }
  
  // Generate a location hash from tooltip content (handles multi-locations with #number suffix)
  private generateLocationHashFromTooltip(tooltipContent: string): string {
    // Extract base name (remove any '#X' suffix for multi-locations)
    const baseName = tooltipContent.split('#')[0].trim();
    
    // Use existing hash generator function if available, or basic sanitization
    if (window.generateLocationHash) {
      return window.generateLocationHash(baseName);
    }
    
    // Basic fallback implementation
    return baseName.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  }

  public async updateContent(
    location: (Location & { type: string }) | null,
    x: number,
    y: number,
    coordIndex?: number,
    nearestLocation?: (Location & { type: string }) | null
  ) {
    await this.ensureInitialized();
    
    // Reset media state
    this.mediaUrls = [];
    this.currentMediaIndex = 0;
    
    // Clear any existing complex location navigation controls first
    const existingNav = this.element.querySelector('.complex-location-nav');
    if (existingNav) {
      existingNav.remove();
    }
    
    // Reset complex coordinates tracking
    this.currentComplexCoordinateInfo = null;
    
    // IMPORTANT FIX: For complex locations, use exact coordinates from the location object
    let displayX = x;
    let displayY = y;
    
    // If this is a complex location with extracted _exactCoordinates, use those
    if (location && '_exactCoordinates' in location && Array.isArray(location._exactCoordinates) && 
        location._exactCoordinates.length === 2) {
      console.log(`Using exact coordinates from location object: [${location._exactCoordinates[0]}, ${location._exactCoordinates[1]}]`);
      displayX = location._exactCoordinates[0];
      displayY = location._exactCoordinates[1];
    } else {
      // Ensure x and y are valid numbers
      displayX = typeof x === 'number' && !isNaN(x) ? Math.round(x) : 0;
      displayY = typeof y === 'number' && !isNaN(y) ? Math.round(y) : 0;
    }
    
    // Store the current coordinate for context in link processing
    this.lastVisitedCoordinate = [displayX, displayY];
    
    if (!location) {
      // For empty location, keep the same order
      this.titleEl.textContent = "Current Coordinate";
      this.coordEl.textContent = `[${displayX}, ${displayY}]`;
      this.descEl.textContent = "No location marker at this position";
      this.imgEl.style.display = "none";
      this.imgEl.src = "";
      this.imgEl.classList.remove('youtube-thumbnail');
      
      // Remove any existing icon
      const existingIcon = this.element.querySelector(".location-icon-container");
      if (existingIcon) {
        existingIcon.remove();
      }
      
      // Add temporary marker icon
      const iconContainer = document.createElement("div");
      iconContainer.className = "location-icon-container";
      
      const tempIcon = document.createElement("img");
      tempIcon.src = "./assets/SF_pointer.svg";
      tempIcon.alt = "";
      tempIcon.className = "location-icon-image";
      tempIcon.style.width = "32px";
      tempIcon.style.height = "32px";
      iconContainer.appendChild(tempIcon);
      
      const locationInfoContainer = this.element.querySelector(".location-info-container");
      if (locationInfoContainer) {
        locationInfoContainer.insertBefore(iconContainer, locationInfoContainer.firstChild);
      }
      
      // Remove any last updated element
      const lastUpdatedEl = this.element.querySelector(".last-updated");
      if (lastUpdatedEl) {
        lastUpdatedEl.remove();
      }
  
      // Show relative location if nearest location is provided
      if (nearestLocation) {
        let relativeLocationEl = this.element.querySelector(".relative-location");
        if (!relativeLocationEl) {
          relativeLocationEl = document.createElement("div");
          relativeLocationEl.className = "relative-location";
          // Insert after coordinates element
          this.coordEl.after(relativeLocationEl);
        }
        
        const nearestCoords = Array.isArray(nearestLocation.coordinates[0])
          ? nearestLocation.coordinates[0] as [number, number]
          : nearestLocation.coordinates as [number, number];
        const direction = getRelativeDirection(
          [x, y],
          nearestCoords
        );
        relativeLocationEl.textContent = `${direction} of ${nearestLocation.name}`;
      } else {
        this.element.querySelector(".relative-location")?.remove();
      }
    } else {
      // Track if we're dealing with a complex coordinate structure
      const isComplexLocation = location.coordinates?.length > 0 && 
                               typeof location.coordinates[0] === 'object' &&
                               (location.coordinates[0] as any).coordinates;
      
      // Get coordinate-specific properties if available
      const locationWithProps = this.getCoordinateSpecificProperties(location, coordIndex);
      
      // Log details for debugging
      console.log(`updateContent for ${location.name}, coordIndex=${coordIndex}, isComplex=${isComplexLocation}`);
      console.log(`Coordinates display: [${displayX}, ${displayY}]`);
      if (locationWithProps.actualCoordinates) {
        console.log(`Actual coordinates from nested object:`, locationWithProps.actualCoordinates);
      }
      
      let locationTitle = locationWithProps.name;
      
      // If it's a complex multi-location, add point number to the title
      if (isComplexLocation) {
        const totalPoints = location.coordinates.length;
        const pointIndex = coordIndex !== undefined ? coordIndex : 0;
        
        // Update the tracking of complex coordinates
        this.currentComplexCoordinateInfo = {
          locationName: location.name,
          currentIndex: pointIndex,
          totalPoints: totalPoints
        };
        
        locationTitle += ` #${pointIndex + 1}`;
        console.log(`Showing complex location: ${locationTitle} (point ${pointIndex + 1} of ${totalPoints})`);
      } else {
        this.currentComplexCoordinateInfo = null;
      }
    
      // 1. Icon (already first)
      const locationInfoContainer = this.element.querySelector(
        ".location-info-container"
      );
    
      const existingIcon = locationInfoContainer?.querySelector(".location-icon-container");
      if (existingIcon) {
        existingIcon.remove();
      }
    
      if (locationWithProps.icon || locationWithProps.iconColor) {
        const iconContainer = document.createElement("div");
        iconContainer.className = "location-icon-container";
        // Add cursor style and title to indicate it's clickable
        iconContainer.style.cursor = "pointer";
        iconContainer.title = "Click to center map on this location";
    
        // Icon code... (unchanged)
        if (locationWithProps.icon) {
          const isFontAwesome = locationWithProps.icon.startsWith("fa-") || locationWithProps.icon.includes("fa-");
          const size = locationWithProps.iconSize || 1;
    
          if (isFontAwesome) {
            const faIcon = document.createElement("i");
            faIcon.className = locationWithProps.icon;
            faIcon.style.fontSize = `${32 * size}px`;
            if (locationWithProps.iconColor) {
              faIcon.style.color = locationWithProps.iconColor;
            }
            faIcon.style.textShadow = "2px 2px 4px rgba(0, 0, 0, 0.7)";
            iconContainer.appendChild(faIcon);
          } else {
            const standardSize = 32 * size;
            const iconImg = document.createElement("img");
            iconImg.src = getIconUrl(locationWithProps.icon);
            iconImg.alt = "";
            iconImg.className = "location-icon-image";
            iconImg.style.width = `${standardSize}px`;
            iconImg.style.height = `${standardSize}px`;
            if (locationWithProps.iconColor) {
              iconImg.style.filter = `drop-shadow(0 0 2px ${locationWithProps.iconColor})`;
            }
            iconContainer.appendChild(iconImg);
          }
        } else if (locationWithProps.iconColor) {
          const defaultIcon = document.createElement("span");
          defaultIcon.className = "material-icons default-location-icon";
          defaultIcon.textContent = "location_on";
          defaultIcon.style.color = locationWithProps.iconColor;
          iconContainer.appendChild(defaultIcon);
        }
    
        if (locationInfoContainer) {
          locationInfoContainer.insertBefore(
            iconContainer,
            locationInfoContainer.firstChild
          );
          
          // Add click handler to focus the map on this location
          iconContainer.addEventListener("click", () => {
            // Store the coordinates we want to navigate to
            const coords: [number, number] = locationWithProps._exactCoordinates || [displayX, displayY];
            
            // Get map instance
            const map = this.map || getMap();
            if (map) {
              // Animate to the location
              map.flyTo([coords[1], coords[0]], map.getZoom(), {
                duration: 1.2,
                easeLinearity: 0.25
              });
              
              // Highlight the marker
              const marker = this.markers.find((m) => {
                const pos = m.getLatLng();
                return pos.lat === coords[1] && pos.lng === coords[0];
              });
              
              if (marker) {
                // Add selected state
                document.querySelectorAll(".custom-location-icon.selected").forEach((el) => {
                  el.classList.remove("selected");
                });
                marker.getElement()?.classList.add("selected");
              }
            }
          });
        }
      }
    
      // 2. Title - Now with spoilers button if applicable
      this.titleEl.textContent = locationTitle;
      
      // Add navigation controls for complex locations
      if (this.currentComplexCoordinateInfo && this.currentComplexCoordinateInfo.totalPoints > 1) {
        this.addComplexLocationNavigation(location, coordIndex || 0);
      }
      
      // Add spoilers button if spoiler content exists
      if (locationWithProps.spoilers) {
        // Remove any existing spoiler button first
        const existingSpoilerBtn = this.element.querySelector('.spoiler-button');
        if (existingSpoilerBtn) {
          existingSpoilerBtn.remove();
        }
    
        // Create spoiler button
        const spoilerBtn = document.createElement('button');
        spoilerBtn.className = 'spoiler-button';
        spoilerBtn.innerHTML = '<i class="fa-solid fa-scroll"></i>';
        spoilerBtn.title = 'Show spoilers';
        
        // Position it after the title
        this.titleEl.parentNode?.insertBefore(spoilerBtn, this.titleEl.nextSibling);
        
        // Create hidden spoiler content container
        let spoilerContent = this.element.querySelector('.spoiler-content') as HTMLElement;
        if (!spoilerContent) {
          spoilerContent = document.createElement('div');
          spoilerContent.className = 'spoiler-content';
          this.descEl.parentNode?.insertBefore(spoilerContent, this.descEl.nextSibling);
        }
        spoilerContent.innerHTML = locationWithProps.spoilers;
        spoilerContent.style.display = 'none';
        
        // Add click handler for spoiler toggle
        spoilerBtn.addEventListener('click', () => {
          const isVisible = spoilerContent.style.display !== 'none';
          spoilerContent.style.display = isVisible ? 'none' : 'block';
          spoilerBtn.title = isVisible ? 'Show spoilers' : 'Hide spoilers';
          spoilerBtn.classList.toggle('active', !isVisible);
        });
      } else {
        // Remove spoiler button and content if they exist
        const existingSpoilerBtn = this.element.querySelector('.spoiler-button');
        const existingSpoilerContent = this.element.querySelector('.spoiler-content');
        if (existingSpoilerBtn) existingSpoilerBtn.remove();
        if (existingSpoilerContent) existingSpoilerContent.remove();
      }
    
      // 3. Coordinates - use the carefully processed display coordinates
      this.coordEl.textContent = `[${displayX}, ${displayY}]`;
    
      // Handle relative location (this is part of coordinates context)
      if (locationWithProps.type !== "location") {
        const nearestLocation = this.locations
          .filter((loc) => loc.type === "location")
          .reduce((nearest, loc) => {
            const locCoords = loc.coordinates as [number, number];
            const currentDist = Math.hypot(x - locCoords[0], y - locCoords[1]);
            const nearestCoords = nearest.coordinates as [number, number];
            const nearestDist = Math.hypot(
              x - nearestCoords[0],
              y - nearestCoords[1]
            );
    
            return currentDist < nearestDist ? loc : nearest;
          });
    
        let relativeLocationEl = this.element.querySelector(".relative-location");
        if (!relativeLocationEl) {
          relativeLocationEl = document.createElement("div");
          relativeLocationEl.className = "relative-location";
          // Insert after coordinates element
          this.coordEl.after(relativeLocationEl);
        }
        
        const direction = getRelativeDirection(
          nearestLocation.coordinates as [number, number],
          [x, y]
        );
        relativeLocationEl.textContent = `${direction} of ${nearestLocation.name}`;
      } else {
        this.element.querySelector(".relative-location")?.remove();
      }
    
      // 4. Description - Now with Markdown link support
      if (locationWithProps.description) {
        // Parse and render any Markdown links in the description
        const parsedDescription = this.parseMarkdownLinks(locationWithProps.description);
        this.descEl.innerHTML = parsedDescription; // Use innerHTML instead of textContent
        
        // Add click handlers to all links
        this.setupLinkHandlers();
      } else {
        this.descEl.textContent = "No description available";
      }
    
      // 5. Lore section - new implementation
      const existingLoreSection = this.element.querySelector('.lore-section');
      if (existingLoreSection) {
        existingLoreSection.remove();
      }
    
      if (locationWithProps.lore) {
        const loreSection = document.createElement('div');
        loreSection.className = 'lore-section';
        
        const loreHeader = document.createElement('div');
        loreHeader.className = 'lore-header';
        
        const loreTitle = document.createElement('span');
        loreTitle.textContent = 'Game Lore';
        
        const loreToggle = document.createElement('span');
        loreToggle.className = 'lore-toggle';
        loreToggle.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        
        loreHeader.appendChild(loreTitle);
        loreHeader.appendChild(loreToggle);
        
        const loreContent = document.createElement('div');
        loreContent.className = 'lore-content';
        loreContent.style.display = 'none'; // Initially hidden
        loreContent.innerHTML = locationWithProps.lore;
        
        loreSection.appendChild(loreHeader);
        loreSection.appendChild(loreContent);
        
        // Insert after description
        this.descEl.after(loreSection);
        
        // Add click handler for toggling
        loreHeader.addEventListener('click', () => {
          const isVisible = loreContent.style.display !== 'none';
          loreContent.style.display = isVisible ? 'none' : 'block';
          loreToggle.querySelector('i')?.classList.toggle('fa-rotate-180', !isVisible);
        });
      }
    
      // 6. Last updated information
      let lastUpdatedEl = this.element.querySelector(".last-updated");
      if (!lastUpdatedEl) {
        lastUpdatedEl = document.createElement("div");
        lastUpdatedEl.className = "last-updated";
        // Insert after description element
        this.descEl.after(lastUpdatedEl);
      }
      if (locationWithProps.lastModified) {
        lastUpdatedEl.textContent = formatLastUpdated(locationWithProps.lastModified);
        lastUpdatedEl.style.display = "block";
      } else {
        lastUpdatedEl.style.display = "none";
      }
    
      // 7. Media (image or YouTube video)
      if (locationWithProps.mediaUrl) {
        // Handle both single URL and array of URLs
        if (Array.isArray(locationWithProps.mediaUrl)) {
          this.mediaUrls = locationWithProps.mediaUrl;
          if (this.mediaUrls.length > 0) {
            this.updateMediaDisplay(this.mediaUrls[0]);
          } else {
            this.imgEl.style.display = "none";
            this.imgEl.src = "";
          }
        } else {
          // Single media URL
          this.mediaUrls = [locationWithProps.mediaUrl];
          this.updateMediaDisplay(locationWithProps.mediaUrl);
        }
      } else {
        this.imgEl.style.display = "none";
        this.imgEl.src = "";
        this.imgEl.classList.remove('youtube-thumbnail');
        
        // Remove any existing video button
        const existingBtn = this.element.querySelector('.video-button');
        if (existingBtn) {
          existingBtn.remove();
        }
        
        // Remove any existing navigation
        const existingNav = this.element.querySelector('.media-navigation');
        if (existingNav) {
          existingNav.remove();
        }
      }
    }
  
    // Update URL parameters - only if not triggered by URL change or complex navigation
    if ((location || (x !== undefined && y !== undefined)) && 
        !window.isHandlingHistoryNavigation && 
        !window.complexNavigationInProgress) {
      if (location) {
        // Check if this is a multi-location and determine which index is being shown
        const isMultiLocation = Array.isArray(location.coordinates[0]) || 
                               (typeof location.coordinates[0] === 'object' && 
                                (location.coordinates[0] as any).coordinates);
        
        if (isMultiLocation && coordIndex !== undefined) {
          // Convert from 0-based (internal) to 1-based (URL)
          const urlParams = `?loc=${generateLocationHash(location.name)}&index=${coordIndex + 1}`;
          window.history.replaceState({}, "", urlParams);
        } else {
          const urlParams = `?loc=${generateLocationHash(location.name)}`;
          window.history.replaceState({}, "", urlParams);
        }
      } else {
        const urlParams = `?coord=${Math.round(displayX)},${Math.round(displayY)}`;
        window.history.replaceState({}, "", urlParams);
      }
    }
  
    this.showSidebar();
  }

  private initializeImageHandlers() {
    const closeModal = () => {
      this.imageModal.style.display = "none";
      
      // Clean up properly when closing the modal
      const iframe = this.imageModal.querySelector('iframe');
      if (iframe) {
        iframe.src = '';
        iframe.remove();
      }
      
      // Reset image visibility for next use
      this.modalImage.style.display = 'block';
      this.modalImage.src = '';
      
      // Reset current media index when closing modal
      this.currentMediaIndex = 0;
    };
    
    // Handle media navigation in the modal
    const setupModalNavigation = () => {
      // Remove any existing navigation controls
      const existingNavigation = this.imageModal.querySelectorAll('.media-navigation');
      existingNavigation.forEach(nav => nav.remove());
      
      // Only add navigation if we have multiple media items
      if (this.mediaUrls.length <= 1) return;
      
      // Create navigation container
      const navigationContainer = document.createElement('div');
      navigationContainer.className = 'media-navigation';
      
      // Previous button
      const prevButton = document.createElement('button');
      prevButton.className = 'nav-button prev';
      prevButton.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
      prevButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateMedia(-1, true);
      });
      
      // Next button
      const nextButton = document.createElement('button');
      nextButton.className = 'nav-button next';
      nextButton.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      nextButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateMedia(1, true);
      });
      
      // Media counter
      const counter = document.createElement('div');
      counter.className = 'media-counter';
      counter.textContent = `${this.currentMediaIndex + 1}/${this.mediaUrls.length}`;
      
      navigationContainer.appendChild(prevButton);
      navigationContainer.appendChild(counter);
      navigationContainer.appendChild(nextButton);
      
      const modalContent = this.imageModal.querySelector('.modal-content');
      if (modalContent) {
        modalContent.appendChild(navigationContainer);
      }
    };

    this.imgEl.addEventListener("click", () => {
      if (this.mediaUrls.length > 0) {
        this.openMediaModal(this.mediaUrls[this.currentMediaIndex]);
        setupModalNavigation();
      }
    });

    // Add keyboard navigation for the modal
    document.addEventListener('keydown', (e) => {
      if (this.imageModal.style.display === 'flex') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          this.navigateMedia(-1, true);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          this.navigateMedia(1, true);
        } else if (e.key === 'Escape') {
          closeModal();
        }
      }
    });

    this.closeButton.addEventListener("click", closeModal);
    this.imageModal.addEventListener("click", (e) => {
      if (e.target === this.imageModal) closeModal();
    });
  }
  
  // New method to navigate between media items
  private navigateMedia(direction: number, isModal: boolean = false): void {
    if (this.mediaUrls.length <= 1) return;
    
    // Calculate new index with wrapping
    this.currentMediaIndex = (this.currentMediaIndex + direction + this.mediaUrls.length) % this.mediaUrls.length;
    
    const currentMedia = this.mediaUrls[this.currentMediaIndex];
    
    if (isModal) {
      // Update modal content
      this.openMediaModal(currentMedia, false);
      
      // Update counter
      const counter = this.imageModal.querySelector('.media-counter');
      if (counter) {
        counter.textContent = `${this.currentMediaIndex + 1}/${this.mediaUrls.length}`;
      }
    } else {
      // Update sidebar content
      this.updateMediaDisplay(currentMedia);
    }
  }
  
  // New method to open media in modal
  private openMediaModal(mediaUrl: string, resetIndex: boolean = true): void {
    if (resetIndex) {
      this.currentMediaIndex = this.mediaUrls.indexOf(mediaUrl);
      if (this.currentMediaIndex === -1) this.currentMediaIndex = 0;
    }
    
    // Check if the URL is a YouTube link
    const youtubeId = this.getYoutubeVideoId(mediaUrl);
    
    if (youtubeId) {
      // It's a YouTube video - embed it
      const iframe = document.createElement('iframe');
      iframe.width = '100%';
      iframe.height = '500px';
      iframe.src = `https://www.youtube.com/embed/${youtubeId}`;
      iframe.title = "YouTube video player";
      iframe.frameBorder = "0";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      
      // Hide the image element
      this.modalImage.style.display = 'none';
      
      // Find the modal content container and append iframe
      const modalContent = this.imageModal.querySelector('.modal-content');
      if (modalContent) {
        // Remove any existing iframe
        const existingIframe = modalContent.querySelector('iframe');
        if (existingIframe) {
          existingIframe.remove();
        }
        
        modalContent.insertBefore(iframe, this.modalImage);
      }
    } else {
      // It's a regular image
      this.modalImage.src = mediaUrl;
      this.modalImage.style.display = 'block';
      
      // Remove any existing iframe
      const modalContent = this.imageModal.querySelector('.modal-content');
      if (modalContent) {
        const existingIframe = modalContent.querySelector('iframe');
        if (existingIframe) {
          existingIframe.remove();
        }
      }
    }
    
    this.modalTitle.textContent = this.titleEl.textContent || "";
    this.modalDescription.textContent = this.descEl.textContent || "";
    this.imageModal.style.display = "flex";
  }
  
  // Helper method to update the sidebar media display
  private updateMediaDisplay(mediaUrl: string): void {
    // Check if it's a YouTube video
    const youtubeId = this.getYoutubeVideoId(mediaUrl);
    
    if (youtubeId) {
      // For YouTube videos, show a button
      this.imgEl.style.display = "none"; // Hide the image element
      
      // Remove any existing video button first
      const existingBtn = this.element.querySelector('.video-button');
      if (existingBtn) {
        existingBtn.remove();
      }
      
      // Create a button to open the video
      const videoBtn = document.createElement('button');
      videoBtn.className = 'video-button';
      videoBtn.innerHTML = '<i class="fa-brands fa-youtube"></i> Open Video';
      videoBtn.title = 'Click to watch video';
      
      // Insert the button after the description
      const insertAfter = this.descEl.nextSibling;
      this.descEl.parentNode?.insertBefore(videoBtn, insertAfter);
      
      // Add click handler to open the video modal
      videoBtn.addEventListener('click', () => {
        this.openMediaModal(mediaUrl);
      });
      
    } else {
      // For regular images, use the existing image element
      this.imgEl.src = mediaUrl;
      this.imgEl.style.display = "block";
      this.imgEl.classList.remove('youtube-thumbnail');
      this.imgEl.style.cursor = "pointer"; // Add pointer cursor for better UX
      
      // Remove any existing video button
      const existingBtn = this.element.querySelector('.video-button');
      if (existingBtn) {
        existingBtn.remove();
      }
    }
    
    // Add navigation controls if we have multiple media
    this.updateMediaNavigation();
  }
  
  // Add media navigation controls to the sidebar
  private updateMediaNavigation(): void {
    // Remove any existing navigation controls
    const existingNavigation = this.element.querySelectorAll('.media-navigation');
    existingNavigation.forEach(nav => nav.remove());
    
    // Only add navigation if we have multiple media items
    if (this.mediaUrls.length <= 1) return;
    
    // Create navigation container
    const navigationContainer = document.createElement('div');
    navigationContainer.className = 'media-navigation sidebar-media-nav';
    
    // Previous button
    const prevButton = document.createElement('button');
    prevButton.className = 'nav-button prev';
    prevButton.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateMedia(-1);
    });
    
    // Next button
    const nextButton = document.createElement('button');
    nextButton.className = 'nav-button next';
    nextButton.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateMedia(1);
    });
    
    // Media counter
    const counter = document.createElement('div');
    counter.className = 'media-counter';
    counter.textContent = `${this.currentMediaIndex + 1}/${this.mediaUrls.length}`;
    
    navigationContainer.appendChild(prevButton);
    navigationContainer.appendChild(counter);
    navigationContainer.appendChild(nextButton);
    
    // Insert after the image or video button
    const locationImage = this.element.querySelector('.location-image');
    if (locationImage) {
      locationImage.appendChild(navigationContainer);
    }
  }

  private createCategorySection(
    category: string,
    items: (Location & { type: string })[],
    container: HTMLElement
  ) {
    const categoryDiv = document.createElement("div");
    categoryDiv.className = "category";
    categoryDiv.setAttribute("data-category", category);

    const categoryHeader = document.createElement("div");
    categoryHeader.className = "category-header";

    const titleSpan = document.createElement("span");
    titleSpan.textContent =
      category.charAt(0).toUpperCase() + category.slice(1);

    const visibilityToggle = document.createElement("span");
    visibilityToggle.className = "material-icons visibility-toggle";
    // Set initial visibility icon based on actual visibility state
    const isVisible = this.visibleCategories.has(category);
    visibilityToggle.textContent = isVisible ? "visibility" : "visibility_off";
    if (!isVisible) {
      visibilityToggle.classList.add("hidden");
    }

    const chevronIcon = document.createElement("i");
    chevronIcon.className = "fa-solid fa-chevron-down";

    categoryHeader.appendChild(titleSpan);
    categoryHeader.appendChild(visibilityToggle);
    categoryHeader.appendChild(chevronIcon);

    const categoryContent = document.createElement("div");
    categoryContent.className = "category-content";

    if (category === "custom") {
      if (items.length === 0) {
        const emptyMessage = document.createElement("div");
        emptyMessage.className = "custom-category-empty";
        emptyMessage.innerHTML = `
                <i class="fa-solid fa-right-click"></i>
                <span>To add a custom marker, right click the location on the map</span>
            `;
        categoryContent.appendChild(emptyMessage);
      } else {
        items.forEach((item) => this.createLocationItem(item, categoryContent));
      }
    } else {
      items.forEach((item) => this.createLocationItem(item, categoryContent));
    }

    visibilityToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleCategoryVisibility(category, items, visibilityToggle);
    });

    categoryHeader.addEventListener("click", () => {
      categoryContent.classList.toggle("open");
      chevronIcon.classList.toggle("fa-chevron-up");
    });

    categoryDiv.appendChild(categoryHeader);
    categoryDiv.appendChild(categoryContent);
    container.appendChild(categoryDiv);
  }

  private createLocationItem(
    item: Location & { type: string },
    container: HTMLElement
  ) {
    const hasMultipleCoords = Array.isArray(item.coordinates[0]);
    let itemDiv: HTMLElement;

    if (hasMultipleCoords) {
      this.createMultiLocationItem(item, container);
      return;
    } else {
      itemDiv = this.createSingleLocationItem(item, container);
    }

    if (item.type === "custom" && itemDiv) {
      const actions = document.createElement("div");
      actions.className = "custom-marker-actions";

      const deleteBtn = document.createElement("button");
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.customMarkerService.deleteMarker((item as CustomMarker).id);
        container.removeChild(itemDiv);
        const coords = item.coordinates as [number, number];
        const marker = this.markers.find((m) => {
          const pos = m.getLatLng();
          return pos.lat === coords[1] && pos.lng === coords[0];
        });
        if (marker) marker.remove();
      });

      const exportBtn = document.createElement("button");
      exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i>';
      exportBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const yaml = this.customMarkerService.exportMarkerAsYaml(
          (item as CustomMarker).id
        );
        const blob = new Blob([yaml], { type: "text/yaml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}.yml`;
        a.click();
        URL.revokeObjectURL(url);
      });

      actions.appendChild(deleteBtn);
      actions.appendChild(exportBtn);
      itemDiv.appendChild(actions);
    }
  }

  private createMultiLocationItem(
    item: Location & { type: string },
    container: HTMLElement
  ) {
    const parentDiv = document.createElement("div");
    parentDiv.className = "category";
    parentDiv.setAttribute("data-name", item.name);

    const headerDiv = document.createElement("div");
    headerDiv.className = "category-header";

    const iconContainer = document.createElement("div");
    iconContainer.className = "location-icon";

    if (item.icon) {
      const isFontAwesome =
        item.icon.startsWith("fa-") || item.icon.includes("fa-");
      const size = item.iconSize || 1;

      if (isFontAwesome) {
        const faIcon = document.createElement("i");
        faIcon.className = item.icon;
        faIcon.style.fontSize = `${20 * size}px`;
        if (item.iconColor) {
          faIcon.style.color = item.iconColor;
        }
        faIcon.style.textShadow = "1px 1px 2px rgba(0, 0, 0, 0.5)";
        iconContainer.appendChild(faIcon);
      } else {
        const standardSize = 20 * size;
        const iconImg = document.createElement("img");
        iconImg.src = getIconUrl(item.icon);
        iconImg.alt = "";
        iconImg.style.width = `${standardSize}px`;
        iconImg.style.height = `${standardSize}px`;
        if (item.iconColor) {
          iconImg.style.filter = `drop-shadow(0 0 1px ${item.iconColor})`;
        }
        iconContainer.appendChild(iconImg);
      }
    } else {
      const defaultIcon = document.createElement("span");
      defaultIcon.className = "material-icons default-location-icon";
      defaultIcon.textContent = "location_on";
      if (item.iconColor) {
        defaultIcon.style.color = item.iconColor;
      }
      iconContainer.appendChild(defaultIcon);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "location-name";
    nameSpan.textContent = item.name;

    const visibilityToggle = document.createElement("span");
    visibilityToggle.className = "material-icons visibility-toggle";
    // Set initial visibility icon based on actual visibility state
    const isVisible = this.visibleMarkers.has(item.name);
    visibilityToggle.textContent = isVisible ? "visibility" : "visibility_off";
    if (!isVisible) {
      visibilityToggle.classList.add("hidden");
    }

    const chevronIcon = document.createElement("i");
    chevronIcon.className = "fa-solid fa-chevron-down";

    headerDiv.appendChild(iconContainer);
    headerDiv.appendChild(nameSpan);
    headerDiv.appendChild(visibilityToggle);
    headerDiv.appendChild(chevronIcon);

    const dropdownContent = document.createElement("div");
    dropdownContent.className = "category-content";

    // Handle the case where we have complex coordinate structure
    const isComplexCoordinates = item.coordinates?.length > 0 && 
                             typeof item.coordinates[0] === 'object' &&
                             (item.coordinates[0] as any).coordinates;
                             
    console.log(`Creating multi-location item: ${item.name}, isComplex: ${isComplexCoordinates}, coordinates:`, 
              isComplexCoordinates ? 'Complex object structure' : 'Standard array structure');
    
    // Iterate through coordinates regardless of format
    if (isComplexCoordinates) {
      // For complex structures like tuvalkane.yml
      item.coordinates.forEach((coordItem: any, index: number) => {
        // Extract coordinates from the nested object
        const coords = coordItem.coordinates;
        
        // Create a location option for this coordinate
        const locationOption = document.createElement("div");
        locationOption.className = "location-item";

        const coordSpan = document.createElement("span");
        coordSpan.className = "location-name";
        coordSpan.textContent = `#${index + 1}`;
        
        // Show the description if available
        if (coordItem.description) {
          coordSpan.title = coordItem.description;
        }

        // Create visibility toggle
        const coordToggle = document.createElement("span");
        coordToggle.className = "material-icons visibility-toggle";
        
        // Set initial visibility icon based on actual visibility state
        const markerId = `${item.name}-${index}`;
        const isMarkerVisible = this.visibleMarkers.has(markerId);
        coordToggle.textContent = isMarkerVisible ? "visibility" : "visibility_off";
        if (!isMarkerVisible) {
          coordToggle.classList.add("hidden");
        }

        locationOption.appendChild(coordSpan);
        locationOption.appendChild(coordToggle);

        coordSpan.addEventListener("click", () => {
          // Pass the index to handleLocationClick, which will extract the nested coordinates
          this.handleLocationClick(coords, item, index);
        });

        coordToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const markerKey = `${item.name}-${index}`;
          this.toggleMarkerVisibility(markerKey, coordToggle, coords);
        });

        dropdownContent.appendChild(locationOption);
      });
    } else {
      // Standard coordinate array handling
      (item.coordinates as [number, number][]).forEach((coords, index) => {
        // ...existing code for standard coordinates...
        const locationOption = document.createElement("div");
        locationOption.className = "location-item";

        const coordSpan = document.createElement("span");
        coordSpan.className = "location-name";
        coordSpan.textContent = `#${index + 1}`;

        const coordToggle = document.createElement("span");
        coordToggle.className = "material-icons visibility-toggle";
        // Set initial visibility icon based on actual visibility state
        const markerId = `${item.name}-${index}`;
        const isMarkerVisible = this.visibleMarkers.has(markerId);
        coordToggle.textContent = isMarkerVisible ? "visibility" : "visibility_off";
        if (!isMarkerVisible) {
          coordToggle.classList.add("hidden");
        }

        locationOption.appendChild(coordSpan);
        locationOption.appendChild(coordToggle);

        coordSpan.addEventListener("click", () => {
          // Pass the index to handleLocationClick
          this.handleLocationClick(coords, item, index);
        });

        coordToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const markerKey = `${item.name}-${index}`;
          this.toggleMarkerVisibility(markerKey, coordToggle, coords);
        });

        dropdownContent.appendChild(locationOption);
      });
    }

    headerDiv.appendChild(iconContainer);
    headerDiv.appendChild(nameSpan);
    headerDiv.appendChild(visibilityToggle);
    headerDiv.appendChild(chevronIcon);

    parentDiv.appendChild(headerDiv);
    parentDiv.appendChild(dropdownContent);
    container.appendChild(parentDiv);
  }

  private createSingleLocationItem(
    item: Location & { type: string },
    container: HTMLElement
  ): HTMLElement {
    const itemDiv = document.createElement("div");
    itemDiv.className = "location-item";

    const iconContainer = document.createElement("div");
    iconContainer.className = "location-icon";

    if (item.icon) {
      const isFontAwesome =
        item.icon.startsWith("fa-") || item.icon.includes("fa-");
      const size = item.iconSize || 1;

      if (isFontAwesome) {
        const faIcon = document.createElement("i");
        faIcon.className = item.icon;
        faIcon.style.fontSize = `${20 * size}px`;
        if (item.iconColor) {
          faIcon.style.color = item.iconColor;
        }
        faIcon.style.textShadow = "1px 1px 2px rgba(0, 0, 0, 0.5)";
        iconContainer.appendChild(faIcon);
      } else {
        const standardSize = 20 * size;
        const iconImg = document.createElement("img");
        iconImg.src = getIconUrl(item.icon);
        iconImg.alt = "";
        iconImg.style.width = `${standardSize}px`;
        iconImg.style.height = `${standardSize}px`;
        if (item.iconColor) {
          iconImg.style.filter = `drop-shadow(0 0 1px ${item.iconColor})`;
        }
        iconContainer.appendChild(iconImg);
      }
    } else {
      const defaultIcon = document.createElement("span");
      defaultIcon.className = "material-icons default-location-icon";
      defaultIcon.textContent = "location_on";
      if (item.iconColor) {
        defaultIcon.style.color = item.iconColor;
      }
      iconContainer.appendChild(defaultIcon);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "location-name";
    nameSpan.textContent = item.name;

    const visibilityToggle = document.createElement("span");
    visibilityToggle.className = "material-icons visibility-toggle";
    // Set initial visibility icon based on actual visibility state
    const isVisible = this.visibleMarkers.has(item.name);
    visibilityToggle.textContent = isVisible ? "visibility" : "visibility_off";
    if (!isVisible) {
      visibilityToggle.classList.add("hidden");
    }

    itemDiv.appendChild(iconContainer);
    itemDiv.appendChild(nameSpan);
    itemDiv.appendChild(visibilityToggle);

    nameSpan.addEventListener("click", () => {
      const coords = item.coordinates as [number, number];
      this.handleLocationClick(coords, item);
    });

    visibilityToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMarkerVisibility(item.name, visibilityToggle);
    });

    container.appendChild(itemDiv);
    return itemDiv;
  }

  // Add the missing YouTube video ID extraction method
  private getYoutubeVideoId(url: string): string | null {
    if (!url) return null;
    
    // Match YouTube URL patterns
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
      /youtube\.com\/watch.*?[?&]v=([^&]+)/,
      /youtube\.com\/shorts\/([^&?/]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  private handleLocationClick(
    coords: [number, number],
    item: Location & { type: string },
    index?: number // Add index parameter
  ) {
    // Get map - try from instance, then fallback to global helper
    const map = this.map || getMap();
    
    // Add additional guard against re-entrancy
    if (window.clickNavigationInProgress) {
      console.log("Click navigation already in progress, skipping");
      return;
    }
    
    window.clickNavigationInProgress = true;
    
    try {
      // Check if we're already at this location to prevent unnecessary navigation
      if (window.lastNavigatedLocation === item.name && 
          window.lastNavigatedIndex === index) {
        console.log("Already at this location, skipping navigation");
        return;
      }
      
      // Log information about what we're navigating to
      const isComplexStructure = typeof item.coordinates[0] === 'object' && 
                               (item.coordinates[0] as any).coordinates;
                               
      console.log(`Navigating to ${item.name}${index !== undefined ? ` point #${index + 1}` : ''} at [${coords[0]}, ${coords[1]}]`, 
                  isComplexStructure ? "Complex coordinate structure" : "Standard coordinates");
      
      // Store this navigation to prevent loops
      window.lastNavigatedLocation = item.name;
      window.lastNavigatedIndex = index;

      // Get coordinate-specific properties if available
      const locationWithProps = this.getCoordinateSpecificProperties(item, index);
      
      // Update sidebar content before map animation to avoid UI jumps
      // IMPORTANT: Pass the exact coordinates we extracted
      this.updateContent(locationWithProps, coords[0], coords[1], index);
    
      document.querySelectorAll(".custom-location-icon.selected").forEach((el) => {
        el.classList.remove("selected");
      });
    
      // Now start the map animation
      const currentCenter = map.getCenter();
      const distance = map.distance(
        [currentCenter.lat, currentCenter.lng],
        [coords[1], coords[0]]
      );
    
      const targetZoom = this.calculateOptimalZoom(distance);
      const duration = this.calculateAnimationDuration(distance);
    
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
    
      const marker = this.markers.find((m) => {
        const pos = m.getLatLng();
        return pos.lat === coords[1] && pos.lng === coords[0];
      });
    
      if (marker) {
        marker.getElement()?.classList.add("selected");
    
        // Update URL only if not already handling navigation
        if (!window.isHandlingHistoryNavigation) {
          const locationHash = generateLocationHash(item.name);
          
          // For multi-coordinates (including complex structures), always include index
          const isMultiCoordinate = Array.isArray(item.coordinates[0]) || 
                                  (typeof item.coordinates[0] === 'object' && 
                                   (item.coordinates[0] as any).coordinates);
          
          // Convert from 0-based (internal) to 1-based (URL)
          const urlParams = (isMultiCoordinate && index !== undefined) ? 
            `?loc=${locationHash}&index=${index + 1}` : 
            `?loc=${locationHash}`;
          
          console.log(`Sidebar updating URL to: ${urlParams}`);
          window.history.replaceState({}, "", urlParams);
        }
      }
    } finally {
      // Reset navigation lock flag after a short delay
      setTimeout(() => {
        window.clickNavigationInProgress = false;
      }, 50);
    }
  }

  private calculateOptimalZoom(distance: number): number {
    if (distance > 10000) return -2;
    if (distance > 5000) return -1;
    if (distance > 2000) return 0;
    if (distance > 1000) return 1;
    return 2;
  }

  private calculateAnimationDuration(distance: number): number {
    const baseDuration = 1.2;
    const distanceFactor = Math.min(distance / 5000, 1);
    const currentZoom = this.map?.getZoom() || 0;
    const targetZoom = this.calculateOptimalZoom(distance);
    const zoomDiff = Math.abs(currentZoom - targetZoom);
    const zoomFactor = Math.min(zoomDiff / 3, 1);

    return baseDuration + distanceFactor * 1.5 + zoomFactor * 0.8;
  }

  private async toggleMarkerVisibility(
    locationName: string,
    toggleElement: HTMLElement,
    coords?: [number, number]
  ): Promise<void> {
    const markerElement = toggleElement.closest(".location-item");
    const index = markerElement
      ?.querySelector(".location-name")
      ?.textContent?.includes("#")
      ? parseInt(
          markerElement
            .querySelector(".location-name")
            ?.textContent?.split("#")[1] || "1"
        ) - 1
      : undefined;
    const markerKey =
      index !== undefined ? `${locationName}-${index}` : locationName;
    const isVisible = this.visibleMarkers.has(markerKey);
    const marker = this.markers.find((m) => {
      const pos = m.getLatLng();
      const markerContent = m.getTooltip()?.getContent();
      if (index !== undefined) {
        return markerContent?.includes(`${locationName} #${index + 1}`);
      }
      return markerContent === locationName;
    });

    if (marker) {
      const markerElement = marker.getElement();
      if (markerElement) {
        if (isVisible) {
          this.visibleMarkers.delete(markerKey);
          markerElement.classList.add("marker-hidden");
          toggleElement.textContent = "visibility_off";
          toggleElement.classList.add("hidden");
          
          if ((marker as any).uncertaintyCircle) {
            const circleElement = (marker as any).uncertaintyCircle._path;
            if (circleElement) {
              circleElement.classList.add("circle-hidden");
            } else {
              (marker as any).uncertaintyCircle.setStyle({
                opacity: 0,
                fillOpacity: 0
              });
            }
          }
        } else {
          this.visibleMarkers.add(markerKey);
          markerElement.classList.remove("marker-hidden");
          toggleElement.textContent = "visibility";
          toggleElement.classList.remove("hidden");
          
          if ((marker as any).uncertaintyCircle) {
            const circleElement = (marker as any).uncertaintyCircle._path;
            if (circleElement) {
              circleElement.classList.remove("circle-hidden");
            } else {
              (marker as any).uncertaintyCircle.setStyle({
                opacity: 0.6,
                fillOpacity: 0.2
              });
            }
          }
          
          // Force a redraw by repositioning the marker at its current position
          const currentPos = marker.getLatLng();
          marker.setLatLng(currentPos);
        }
      }
    }

    if (this.visibilityMiddleware) {
      await this.visibilityMiddleware.setMarkerVisibility(markerKey, !isVisible);
      
      // If toggling to visible, force a redraw via custom event for immediate visibility
      if (!isVisible) {
        forceMarkerRedraw(markerKey);
      }
    }

    if (!this.visibilityMiddleware) {
      this.saveVisibilityState();
    }
  }

  private async toggleCategoryVisibility(
    category: string,
    items: (Location & { type: string })[],
    toggle: HTMLElement
  ): Promise<void> {
    const isVisible = this.visibleCategories.has(category);

    if (isVisible) {
      this.visibleCategories.delete(category);
      toggle.textContent = "visibility_off";
      toggle.classList.add("hidden");

      const categoryElement = toggle.closest(".category");
      const allToggles =
        categoryElement?.querySelectorAll(".visibility-toggle");
      allToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility_off";
        t.classList.add("hidden");
      });

      items.forEach((item) => {
        this.visibleMarkers.delete(item.name);
        if (Array.isArray(item.coordinates[0])) {
          (item.coordinates as [number, number][]).forEach((_, index) => {
            this.visibleMarkers.delete(`${item.name}-${index}`);
          });
        }

        this.markers.forEach((marker) => {
          const markerName = marker
            .getTooltip()
            ?.getContent()
            .split("#")[0]
            .trim();
          if (markerName === item.name) {
            const element = marker.getElement();
            if (element) {
              element.classList.add("marker-hidden");
              if ((marker as any).uncertaintyCircle) {
                const circleElement = (marker as any).uncertaintyCircle._path;
                if (circleElement) {
                  circleElement.classList.add("circle-hidden");
                } else {
                  (marker as any).uncertaintyCircle.setStyle({
                    opacity: 0,
                    fillOpacity: 0
                  });
                }
              }
            }
          }
        });
      });
    } else {
      this.visibleCategories.add(category);
      toggle.textContent = "visibility";
      toggle.classList.remove("hidden");

      const categoryElement = toggle.closest(".category");
      const allToggles =
        categoryElement?.querySelectorAll(".visibility-toggle");
      allToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility";
        t.classList.remove("hidden");
      });

      items.forEach((item) => {
        this.visibleMarkers.add(item.name);
        if (Array.isArray(item.coordinates[0])) {
          (item.coordinates as [number, number][]).forEach((_, index) => {
            this.visibleMarkers.add(`${item.name}-${index}`);
          });
        }

        this.markers.forEach((marker) => {
          const markerName = marker
            .getTooltip()
            ?.getContent()
            .split("#")[0]
            .trim();
          if (markerName === item.name) {
            const element = marker.getElement();
            if (element) {
              element.classList.remove("marker-hidden");

              if ((marker as any).uncertaintyCircle) {
                const circleElement = (marker as any).uncertaintyCircle._path;
                if (circleElement) {
                  circleElement.classList.remove("circle-hidden");
                } else {
                  (marker as any).uncertaintyCircle.setStyle({
                    opacity: 0.6, 
                    fillOpacity: 0.2
                  });
                }
              }
              
              // Force marker to redraw by refreshing its position
              marker.setLatLng(marker.getLatLng());
            }
          }
        });
      });
    }

    if (this.visibilityMiddleware) {
      // Always pass the current visibility state to the middleware
      await this.visibilityMiddleware.setCategoryVisibility(category, !isVisible);
      
      // Also update all markers in this category
      for (const item of items) {
        if (Array.isArray(item.coordinates[0])) {
          for (let index = 0; index < (item.coordinates as [number, number][]).length; index++) {
            await this.visibilityMiddleware.setMarkerVisibility(`${item.name}-${index}`, !isVisible);
          }
        } else {
          await this.visibilityMiddleware.setMarkerVisibility(item.name, !isVisible);
        }
      }
    }

    if (!this.visibilityMiddleware) {
      this.saveVisibilityState();
    }
  }

  private async toggleMultiMarkerVisibility(
    item: Location & { type: string },
    toggle: HTMLElement
  ): Promise<void> {
    const isVisible = this.visibleMarkers.has(item.name);
    const coordinates = item.coordinates as [number, number][];

    if (isVisible) {
      this.visibleMarkers.delete(item.name);
      toggle.textContent = "visibility_off";
      toggle.classList.add("hidden");

      const itemElement = toggle.closest("[data-name]");
      const childToggles = itemElement?.querySelectorAll(
        ".location-item .visibility-toggle"
      );
      childToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility_off";
        t.classList.add("hidden");
      });

      coordinates.forEach((_, index) => {
        this.visibleMarkers.delete(`${item.name}-${index}`);
      });

      this.markers.forEach((marker) => {
        const markerName = marker
          .getTooltip()
          ?.getContent()
          .split("#")[0]
          .trim();
        if (markerName === item.name) {
          const element = marker.getElement();
          if (element) {
            element.classList.add("marker-hidden");
            
            if ((marker as any).uncertaintyCircle) {
              const circleElement = (marker as any).uncertaintyCircle._path;
              if (circleElement) {
                circleElement.classList.add("circle-hidden");
              } else {
                (marker as any).uncertaintyCircle.setStyle({
                  opacity: 0,
                  fillOpacity: 0
                });
              }
            }
          }
        }
      });
    } else {
      this.visibleMarkers.add(item.name);
      toggle.textContent = "visibility";
      toggle.classList.remove("hidden");

      const itemElement = toggle.closest("[data-name]");
      const childToggles = itemElement?.querySelectorAll(
        ".location-item .visibility-toggle"
      );
      childToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility";
        t.classList.remove("hidden");
      });

      coordinates.forEach((_, index) => {
        this.visibleMarkers.add(`${item.name}-${index}`);
      });

      this.markers.forEach((marker) => {
        const markerName = marker
          .getTooltip()
          ?.getContent()
          .split("#")[0]
          .trim();
        if (markerName === item.name) {
          const element = marker.getElement();
          if (element) {
            element.classList.remove("marker-hidden");

            if ((marker as any).uncertaintyCircle) {
              const circleElement = (marker as any).uncertaintyCircle._path;
              if (circleElement) {
                circleElement.classList.remove("circle-hidden");
              } else {
                (marker as any).uncertaintyCircle.setStyle({
                  opacity: 0.6, 
                  fillOpacity: 0.2
                });
              }
            }
            
            // Force marker to redraw by refreshing its position
            marker.setLatLng(marker.getLatLng());
          }
        }
      });
    }

    if (this.visibilityMiddleware) {
      for (let index = 0; index < coordinates.length; index++) {
        await this.visibilityMiddleware.setMarkerVisibility(`${item.name}-${index}`, !isVisible);
      }
    }

    if (!this.visibilityMiddleware) {
      this.saveVisibilityState();
    }
  }

  public async addCustomMarker(
    marker: Location & { type: string }
  ): Promise<void> {
    await this.ensureInitialized();
    this.locations.push(marker);

    const customCategory = this.element.querySelector(
      '[data-category="custom"]'
    );
    if (customCategory) {
      const categoryContent = customCategory.querySelector(".category-content");
      if (categoryContent) {
        if (categoryContent.querySelector(".custom-category-empty")) {
          categoryContent.innerHTML = "";
        }
        this.createLocationItem(marker, categoryContent);
        this.visibleMarkers.add(marker.name);
        this.visibleCategories.add("custom");
      }
    }
  }

  private initializeElements(): void {
    this.titleEl = this.element.querySelector(".location-title") as HTMLElement;
    this.descEl = this.element.querySelector(".location-description") as HTMLElement;
    this.coordEl = this.element.querySelector(".coordinates-display") as HTMLElement;
    this.imgEl = this.element.querySelector("#sidebar-image") as HTMLImageElement;
    this.imageModal = document.querySelector("#image-modal") as HTMLElement;
    this.modalImage = document.querySelector("#modal-image") as HTMLImageElement;
    this.modalTitle = document.querySelector(".modal-title") as HTMLElement;
    this.modalDescription = document.querySelector(".modal-description") as HTMLElement;
    this.closeButton = document.querySelector(".close-button") as HTMLElement;
    this.locationDrawer = this.element.querySelector(".location-drawer") as HTMLElement;
    
    // Add CSS for internal links
    const linkStyles = document.createElement('style');
    linkStyles.textContent = `
      .internal-link {
        color: #2196f3; /* Lighter blue color for links */
        text-decoration: underline;
        cursor: pointer;
      }
      
      .internal-link:hover {
        color: #0d8bf2;
        text-decoration: underline;
      }
    `;
    document.head.appendChild(linkStyles);
  }

  private updateCategoryVisibility(toggleElement: HTMLElement): void {
    const categoryElement = toggleElement.closest(".category");
    if (!categoryElement) return;
    const category = categoryElement.getAttribute("data-category");
    if (!category) return;
    const itemToggles = categoryElement.querySelectorAll(".visibility-toggle");
    const allHidden = Array.from(itemToggles).every((t) =>
      t.classList.contains("hidden")
    );
    const categoryToggle = categoryElement.querySelector(
      ".category-header .visibility-toggle"
    );
    if (categoryToggle) {
      if (allHidden) {
        categoryToggle.textContent = "visibility_off";
        categoryToggle.classList.add("hidden");
        this.visibleCategories.delete(category);
      } else {
        categoryToggle.textContent = "visibility";
        categoryToggle.classList.remove("hidden");
        this.visibleCategories.add(category);
      }
    }
  }

  private createTabInterface(): void {
    // Find the tab system container
    const tabSystem = this.element.querySelector(".tab-system") as HTMLElement;
    if (!tabSystem) return;
    
    // Check if tabs already exist and clear them to prevent duplicates
    const existingTabs = tabSystem.querySelector(".sidebar-tabs");
    if (existingTabs) {
      existingTabs.remove();
    }

    // Create fresh tab elements
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "sidebar-tabs";

    const locationTab = document.createElement("button");
    locationTab.className = "sidebar-tab active";
    locationTab.innerHTML = '<span class="material-icons">place</span>Location Info';

    const dropsTab = document.createElement("a");
    dropsTab.className = "sidebar-tab external-link";
    dropsTab.href = "https://www.appsheet.com/start/38410899-f3a8-4362-9312-921cd89718ca";
    dropsTab.target = "_blank";
    dropsTab.rel = "noopener noreferrer";
    dropsTab.innerHTML = '<span class="material-icons">inventory_2</span>Items';

    tabsContainer.appendChild(locationTab);
    tabsContainer.appendChild(dropsTab);

    // Find the location content element
    const locationContent = this.element.querySelector(
      ".sidebar-content.location-info"
    ) as HTMLElement;

    // Insert the tabs container
    tabSystem.insertBefore(tabsContainer, tabSystem.firstChild);

    // Store reference to location content
    this.locationContent = locationContent;
  }

  // Add navigation controls for complex locations with multiple points
  private addComplexLocationNavigation(location: Location & { type: string }, currentIndex: number): void {
    // Remove any existing navigation
    const existingNav = this.element.querySelector('.complex-location-nav');
    if (existingNav) {
      existingNav.remove();
    }
    
    const info = this.currentComplexCoordinateInfo;
    if (!info) return;
    
    // Create navigation container
    const navContainer = document.createElement('div');
    navContainer.className = 'complex-location-nav';
    navContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 8px;
      margin: 8px 0;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    `;
    
    // Previous button
    if (currentIndex > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.innerHTML = '◀ Previous';
      prevBtn.style.cssText = `
        background: rgba(0, 0, 0, 0.3);
        border: none;
        color: white;
        padding: 5px 10px;
        border-radius: 3px;
        cursor: pointer;
      `;
      prevBtn.addEventListener('click', () => {
        this.navigateToComplexPoint(location, currentIndex - 1);
      });
      navContainer.appendChild(prevBtn);
    }
    
    // Point indicator
    const indicator = document.createElement('span');
    indicator.textContent = `Point ${currentIndex + 1} of ${info.totalPoints}`;
    indicator.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
    `;
    navContainer.appendChild(indicator);
    
    // Next button
    if (currentIndex < info.totalPoints - 1) {
      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = 'Next ▶';
      nextBtn.style.cssText = `
        background: rgba(0, 0, 0, 0.3);
        border: none;
        color: white;
        padding: 5px 10px;
        border-radius: 3px;
        cursor: pointer;
      `;
      nextBtn.addEventListener('click', () => {
        this.navigateToComplexPoint(location, currentIndex + 1);
      });
      navContainer.appendChild(nextBtn);
    }
    
    // Insert after the title
    this.titleEl.parentNode?.insertBefore(navContainer, this.titleEl.nextSibling);
  }

  // Navigate between points in a complex location
  private navigateToComplexPoint(location: Location & { type: string }, index: number): void {
    console.log(`Navigating to complex point index ${index} for ${location.name}`);
  
    if (!location.coordinates || index < 0 || index >= location.coordinates.length) {
      console.warn(`Invalid index ${index} for location ${location.name}`);
      return;
    }
    
    // Extract coordinates based on location format
    let coords: [number, number] | null = null;
    
    // Check for complex coordinate structure with nested coordinates property
    if (typeof location.coordinates[0] === 'object' && !Array.isArray(location.coordinates[0])) {
      const coordItem = location.coordinates[index] as any;
      
      if (coordItem && coordItem.coordinates && Array.isArray(coordItem.coordinates) && 
          coordItem.coordinates.length === 2) {
        coords = coordItem.coordinates as [number, number];
        console.log(`Extracted nested coordinates: [${coords[0]}, ${coords[1]}]`);
      }
    }
    // Check for array of coordinate pairs
    else if (Array.isArray(location.coordinates[0])) {
      coords = location.coordinates[index] as [number, number];
      console.log(`Extracted array coordinates: [${coords[0]}, ${coords[1]}]`);
    }
    
    // Validate coordinates before proceeding
    if (!coords || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') {
      console.error(`Failed to extract valid coordinates for ${location.name} at index ${index}`);
      return;
    }
    
    // Set a navigation lock flag to prevent recursive navigation
    window.complexNavigationInProgress = true;
    
    try {
      this.handleLocationClick(coords, location, index);
    } finally {
      // Clear the flag after a short delay
      setTimeout(() => {
        window.complexNavigationInProgress = false;
      }, 50);
    }
  }

  // Separated link handling into its own method for better organization
  private setupLinkHandlers(): void {
    // Add click handlers to internal links
    const internalLinks = this.descEl.querySelectorAll('.internal-link');
    internalLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = (link as HTMLAnchorElement).href;
        const url = new URL(href);
        
        // Bypass the history navigation flag to ensure links always work
        window.isHandlingHistoryNavigation = false;
        
        // Check if this is an internal link (same origin or relative URL)
        const isSameOrigin = url.origin === window.location.origin;
        if (isSameOrigin && window.handleInternalLink) {
          window.handleInternalLink(url);
        } else {
          // For external links, use normal navigation
          window.open(href, '_blank', 'noopener,noreferrer');
        }
      });
    });

    // Add click handlers to coordinate links
    const coordLinks = this.descEl.querySelectorAll('.coordinate-link');
    coordLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Extract coordinates from data attributes
        const x = parseInt(link.getAttribute('data-x') || '0', 10);
        const y = parseInt(link.getAttribute('data-y') || '0', 10);
        
        if (isNaN(x) || isNaN(y)) return;
        
        // Bypass the history navigation flag to ensure coordinate links always work
        window.isHandlingHistoryNavigation = false;
        
        // Use coordinate navigation 
        if (window.navigateToCoordinates) {
          window.navigateToCoordinates([x, y]);
        } else if (window.handleInternalLink) {
          // Fallback to URL-based navigation
          const url = new URL(`${window.location.origin}${window.location.pathname}?coord=${x},${y}`);
          window.handleInternalLink(url);
        } else {
          // Last resort - update URL directly
          window.location.href = `?coord=${x},${y}`;
        }
      });
    });
  }

  // Add a new method to update locations without reinitializing the whole sidebar
  public updateLocations(newLocations: (Location & { type: string })[]): void {
    console.log(`Sidebar updating locations, received ${newLocations.length} locations`);
    
    // Store the current location if any is selected
    const currentLocationName = this.titleEl?.textContent?.split('#')[0]?.trim();
    let currentCoordIndex: number | undefined;
    
    // Check if we're viewing a specific coordinate index
    if (this.currentComplexCoordinateInfo) {
      currentCoordIndex = this.currentComplexCoordinateInfo.currentIndex;
    }
    
    // Update the locations array
    this.locations = newLocations;
    
    // Only update the drawer if we're initialized
    if (this.initialized) {
      // Clear existing location list
      const categoriesContainer = this.element.querySelector('.categories');
      if (categoriesContainer) {
        categoriesContainer.innerHTML = '';
        
        // Re-group locations
        const groupedLocations = this.locations.reduce((acc, location) => {
          if (!acc[location.type]) acc[location.type] = [];
          acc[location.type].push(location);
          return acc;
        }, {} as Record<string, (Location & { type: string })[]>);
        
        // Rebuild location drawer
        for (const [category, items] of Object.entries(groupedLocations)) {
          this.createCategorySection(category, items, categoriesContainer);
        }
      }
      
      // If we were viewing a location, try to update the current view
      if (currentLocationName) {
        const updatedLocation = newLocations.find(loc => 
          loc.name === currentLocationName
        );
        
        if (updatedLocation) {
          // Get coordinate values
          let coordinates: [number, number];
          
          if (currentCoordIndex !== undefined && Array.isArray(updatedLocation.coordinates[0])) {
            // Multi-location with known index
            coordinates = updatedLocation.coordinates[currentCoordIndex] as [number, number];
          } else if (typeof updatedLocation.coordinates[0] === 'object' && 
                    (updatedLocation.coordinates[0] as any).coordinates && 
                    currentCoordIndex !== undefined) {
            // Complex location with nested coordinates
            coordinates = (updatedLocation.coordinates[currentCoordIndex] as any).coordinates;
          } else {
            // Simple location
            coordinates = updatedLocation.coordinates as [number, number];
          }
          
          // Update the content with the new location data
          this.updateContent(updatedLocation, coordinates[0], coordinates[1], currentCoordIndex);
        }
      }
    }
    
    console.log('Sidebar locations updated successfully');
  }
}
