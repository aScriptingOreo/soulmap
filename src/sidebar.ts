import * as L from "leaflet";
import type { Location, ItemDrop } from "./types";
import { generateLocationHash, getRelativeDirection } from "./utils";
import { CustomMarkerService } from "./services/customMarkers";
import { loadDrops, findDropLocations } from "./drops/dropsLoader"; // Add this import

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
  private hasCustomCategory: boolean = false; // Add this flag
  private dropsContent!: HTMLElement; // Add this property
  private locationContent!: HTMLElement; // Add this property

  constructor(options: SidebarOptions) {
    this.element = options.element;
    this.locations = options.locations;
    this.map = options.map;
    this.markers = options.markers;
    this.customMarkerService = new CustomMarkerService();

    // Create and add toggle button immediately
    this.createToggleButton();

    // Add listener for empty custom markers
    window.addEventListener("customMarkersEmpty", () => {
      const customCategory = this.element.querySelector(
        '[data-category="custom"]'
      );
      if (customCategory) {
        customCategory.remove();
        this.hasCustomCategory = false; // Update flag when removing category
      }
    });
  }

  private createToggleButton(): void {
    this.toggleButton = document.createElement("button");
    this.toggleButton.id = "sidebar-toggle";
    // Start with both sidebar and button collapsed
    this.toggleButton.className = "sidebar-toggle collapsed";
    this.element.classList.add("collapsed");

    const icon = document.createElement("span");
    icon.className = "material-icons";
    icon.textContent = "chevron_left";
    this.toggleButton.appendChild(icon);

    document.body.appendChild(this.toggleButton);

    // Initialize toggle functionality
    this.toggleButton.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.ensureInitialized();

      const isCollapsed = this.element.classList.contains("collapsed");
      if (isCollapsed) {
        // Opening sidebar
        this.element.classList.remove("collapsed");
        this.toggleButton.classList.remove("collapsed");
      } else {
        // Closing sidebar
        this.element.classList.add("collapsed");
        this.toggleButton.classList.add("collapsed");
        // Clear URL parameters
        window.history.replaceState({}, "", window.location.pathname);

        // Remove selected state from markers
        document
          .querySelectorAll(".custom-location-icon.selected")
          .forEach((el) => {
            el.classList.remove("selected");
          });
      }
    });

    // Add keyboard shortcut
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        this.toggleButton.click();
      }
    });

    // Make button visible immediately with correct initial state
    requestAnimationFrame(() => {
      this.toggleButton.classList.add("loaded");
      this.element.classList.add("loaded");
    });
  }

  // Update showSidebar method to ensure consistent state
  private showSidebar(): void {
    this.element.classList.remove("collapsed");
    this.toggleButton.classList.remove("collapsed");
    // Add loaded class if not already present
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
    this.initializeElements();
    this.createTabInterface(); // Add this
    await this.loadVisibilityState();
    await this.initializeComponentsAsync();
    await this.createDropsInterface(); // Add this
    this.initialized = true;

    // Always show loaded state
    requestAnimationFrame(() => {
      this.element.classList.add("loaded");
      this.toggleButton.classList.add("loaded");
    });
  }

  // Helper method to find closest location
  private findClosestLocation(
    coords: [number, number]
  ): (Location & { type: string }) | undefined {
    let closest = this.locations[0];
    let minDist = Infinity;

    this.locations.forEach((location) => {
      const locCoords = Array.isArray(location.coordinates[0])
        ? location.coordinates[0]
        : (location.coordinates as [number, number]);

      const dist = Math.hypot(
        coords[0] - locCoords[0],
        coords[1] - locCoords[1]
      );
      if (dist < minDist) {
        minDist = dist;
        closest = location;
      }
    });

    return closest;
  }

  private async loadVisibilityState(): Promise<void> {
    // Default: make everything visible
    this.visibleMarkers = new Set(this.locations.map((l) => l.name));
    this.visibleCategories = new Set(this.locations.map((l) => l.type));
  }

  private async initializeComponentsAsync(): Promise<void> {
    // Create the locations list container
    const locationsList = document.createElement("div");
    locationsList.className = "locations-list drawer-content";

    // Create the categories container
    const categoriesContainer = document.createElement("div");
    categoriesContainer.className = "categories";
    locationsList.appendChild(categoriesContainer);

    // Group locations by type
    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) acc[location.type] = [];
      acc[location.type].push(location);
      return acc;
    }, {} as Record<string, (Location & { type: string })[]>);

    // Initialize handlers that don't depend on DOM creation
    this.initializeImageHandlers();

    // Create location drawer elements asynchronously in chunks
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

    // Create drawer container with header
    const drawerHeader = document.createElement("div");
    drawerHeader.className = "drawer-header";
    drawerHeader.id = "drawer-toggle";
    drawerHeader.innerHTML = `<span>Locations List</span>`;

    const drawerContainer = document.createElement("div");
    drawerContainer.className = "location-drawer";
    drawerContainer.appendChild(drawerHeader);
    drawerContainer.appendChild(locationsList);

    // Add drawer to sidebar
    this.element.appendChild(drawerContainer);

    // Store reference to location drawer
    this.locationDrawer = drawerContainer;
  }

  // Update this method to ensure initialization before updating content
  async updateContent(
    location: (Location & { type: string }) | null,
    x: number,
    y: number
  ) {
    await this.ensureInitialized();

    if (!location) {
      // Handle coordinate-only display
      this.titleEl.textContent = "Current Coordinate";
      this.descEl.textContent = "No location marker at this position";
      this.coordEl.textContent = `[${Math.round(x)}, ${Math.round(y)}]`;
      this.imgEl.style.display = "none";
      this.imgEl.src = "";

      // Update URL with raw coordinates
      const urlParams = `?coord=${Math.round(x)},${Math.round(y)}`;
      window.history.replaceState({}, "", urlParams);
    } else {
      // Handle location display
      let locationTitle = location.name;

      // Check if this is part of a multi-location marker
      if (Array.isArray(location.coordinates[0])) {
        const coords = location.coordinates as [number, number][];
        const index = coords.findIndex(
          (coord) => coord[0] === x && coord[1] === y
        );
        if (index !== -1) {
          locationTitle = `${location.name} #${index + 1}`;
        }
      }

      this.titleEl.textContent = locationTitle;

      // Add relative location info if not a location marker type
      if (location.type !== "location") {
        const nearestLocation = this.locations
          .filter((loc) => loc.type === "location")
          .reduce((nearest, loc) => {
            const locCoords = loc.coordinates as [number, number]; // Location markers are single point
            const currentDist = Math.hypot(x - locCoords[0], y - locCoords[1]);

            const nearestCoords = nearest.coordinates as [number, number];
            const nearestDist = Math.hypot(
              x - nearestCoords[0],
              y - nearestCoords[1]
            );

            return currentDist < nearestDist ? loc : nearest;
          });

        // Create or update relative location element
        let relativeLocationEl =
          this.element.querySelector(".relative-location");
        if (!relativeLocationEl) {
          relativeLocationEl = document.createElement("div");
          relativeLocationEl.className = "relative-location";
          this.titleEl.after(relativeLocationEl);
        }
        const direction = getRelativeDirection(
          nearestLocation.coordinates as [number, number],
          [x, y]
        );
        relativeLocationEl.textContent = `${direction} of ${nearestLocation.name}`;
      } else {
        // Remove relative location element if it exists
        this.element.querySelector(".relative-location")?.remove();
      }

      // Show main description and image for both parent and child items
      this.descEl.textContent =
        location.description || "No description available";
      this.coordEl.textContent = `[${Math.round(x)}, ${Math.round(y)}]`;

      if (location.imgUrl) {
        this.imgEl.src = location.imgUrl;
        this.imgEl.style.display = "block";
      } else {
        this.imgEl.style.display = "none";
        this.imgEl.src = "";
      }
    }

    // Show sidebar when updating content
    this.showSidebar();
  }

  // Initialize image modal handlers
  private initializeImageHandlers() {
    const closeModal = () => {
      this.imageModal.style.display = "none";
    };

    this.imgEl.addEventListener("click", () => {
      if (this.imgEl.src) {
        this.modalImage.src = this.imgEl.src;
        this.modalTitle.textContent = this.titleEl.textContent || "";
        this.modalDescription.textContent = this.descEl.textContent || "";
        this.imageModal.style.display = "flex";
      }
    });

    this.closeButton.addEventListener("click", closeModal);
    this.imageModal.addEventListener("click", (e) => {
      if (e.target === this.imageModal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // Initialize location drawer
  private initializeLocationDrawer() {
    const categoriesContainer = this.element.querySelector(
      ".categories"
    ) as HTMLElement;

    // Group locations by type
    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) {
        acc[location.type] = [];
      }
      acc[location.type].push(location);
      return acc;
    }, {} as { [key: string]: (Location & { type: string })[] });

    // Always create custom category first, regardless of whether there are custom markers
    this.createCategorySection(
      "custom",
      groupedLocations["custom"] || [],
      categoriesContainer
    );
    delete groupedLocations["custom"]; // Remove custom from grouped locations

    // Create other category sections
    Object.entries(groupedLocations).forEach(([category, items]) => {
      this.createCategorySection(category, items, categoriesContainer);
    });

    // Remove the empty category event listener since we want to keep the category
    window.removeEventListener("customMarkersEmpty", () => {});
  }

  // Create category section
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
    visibilityToggle.textContent = "visibility";

    const chevronIcon = document.createElement("i");
    chevronIcon.className = "fa-solid fa-chevron-down";

    categoryHeader.appendChild(titleSpan);
    categoryHeader.appendChild(visibilityToggle);
    categoryHeader.appendChild(chevronIcon);

    const categoryContent = document.createElement("div");
    categoryContent.className = "category-content";

    // Special handling for custom category
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

    // Add category visibility toggle
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

  // Create location item
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
        this.customMarkerService.deleteMarker((item as CustomMarker).id); // Add this.
        container.removeChild(itemDiv);
        // Remove marker from map
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
        ); // Add this.
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

  // Create multi-location item
  private createMultiLocationItem(
    item: Location & { type: string },
    container: HTMLElement
  ) {
    const parentDiv = document.createElement("div");
    parentDiv.className = "category";
    parentDiv.setAttribute("data-name", item.name);

    const headerDiv = document.createElement("div");
    headerDiv.className = "category-header";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name;

    const visibilityToggle = document.createElement("span");
    visibilityToggle.className = "material-icons visibility-toggle";
    visibilityToggle.textContent = "visibility";

    const chevronIcon = document.createElement("i");
    chevronIcon.className = "fa-solid fa-chevron-down";

    headerDiv.appendChild(nameSpan); // Fix: was using titleSpan instead of nameSpan
    headerDiv.appendChild(visibilityToggle);
    headerDiv.appendChild(chevronIcon);

    const dropdownContent = document.createElement("div");
    dropdownContent.className = "category-content";

    (item.coordinates as [number, number][]).forEach((coords, index) => {
      const locationOption = document.createElement("div");
      locationOption.className = "location-item";

      const coordSpan = document.createElement("span");
      coordSpan.className = "location-name";
      coordSpan.textContent = `#${index + 1}`;

      const coordToggle = document.createElement("span");
      coordToggle.className = "material-icons visibilityz-toggle";
      coordToggle.textContent = "visibility";

      locationOption.appendChild(coordSpan);
      locationOption.appendChild(coordToggle);

      coordSpan.addEventListener("click", () => {
        this.handleLocationClick(coords, item);
      });

      coordToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const markerKey = `${item.name}-${index}`;
        this.toggleMarkerVisibility(markerKey, coordToggle, coords);
      });

      dropdownContent.appendChild(locationOption);
    });

    visibilityToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMultiMarkerVisibility(item, visibilityToggle);
    });

    headerDiv.addEventListener("click", () => {
      dropdownContent.classList.toggle("open");
      chevronIcon.classList.toggle("fa-chevron-up");
    });

    parentDiv.appendChild(headerDiv);
    parentDiv.appendChild(dropdownContent);
    container.appendChild(parentDiv);
  }

  // Create single location item
  private createSingleLocationItem(
    item: Location & { type: string },
    container: HTMLElement
  ): HTMLElement {
    const itemDiv = document.createElement("div");
    itemDiv.className = "location-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "location-name";
    nameSpan.textContent = item.name;

    const visibilityToggle = document.createElement("span");
    visibilityToggle.className = "material-icons visibility-toggle";
    visibilityToggle.textContent = "visibility";

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

  // Handle location click
  private handleLocationClick(
    coords: [number, number],
    item: Location & { type: string }
  ) {
    const currentCenter = this.map.getCenter();
    const distance = this.map.distance(
      [currentCenter.lat, currentCenter.lng],
      [coords[1], coords[0]]
    );

    const targetZoom = this.calculateOptimalZoom(distance);
    const duration = this.calculateAnimationDuration(distance);

    // Disable marker animations during flyTo
    this.map.once("movestart", () => {
      document
        .querySelector(".leaflet-marker-pane")
        ?.classList.add("leaflet-zoom-hide");
    });

    this.map.once("moveend", () => {
      document
        .querySelector(".leaflet-marker-pane")
        ?.classList.remove("leaflet-zoom-hide");
    });

    this.map.flyTo([coords[1], coords[0]], targetZoom, {
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
      document
        .querySelectorAll(".custom-location-icon.selected")
        .forEach((el) => {
          el.classList.remove("selected");
        });
      marker.getElement()?.classList.add("selected");

      // Delay the marker click event until the animation is complete
      const animationDuration = this.calculateAnimationDuration(distance);
      setTimeout(() => {
        marker.fire("click");
      }, animationDuration * 1000);

      // Get marker index for multi-location items
      const markerContent = marker.getTooltip()?.getContent() as string;
      const markerIndex = markerContent.includes("#")
        ? parseInt(markerContent.split("#")[1]) - 1
        : undefined;

      // Update URL with location hash and index if applicable
      const locationHash = generateLocationHash(item.name);
      const urlParams =
        markerIndex !== undefined
          ? `?loc=${locationHash}&index=${markerIndex}`
          : `?loc=${locationHash}`;

      window.history.replaceState({}, "", urlParams);
    }
  }

  // Add these improved helper methods to the Sidebar class
  private calculateOptimalZoom(distance: number): number {
    // Adjust zoom based on distance to target
    if (distance > 10000) return -2;
    if (distance > 5000) return -1;
    if (distance > 2000) return 0;
    if (distance > 1000) return 1;
    return 2;
  }

  private calculateAnimationDuration(distance: number): number {
    // Base duration in seconds
    const baseDuration = 1.2;
    // Additional duration based on distance and zoom difference
    const distanceFactor = Math.min(distance / 5000, 1);
    const currentZoom = this.map.getZoom();
    const targetZoom = this.calculateOptimalZoom(distance);
    const zoomDiff = Math.abs(currentZoom - targetZoom);
    const zoomFactor = Math.min(zoomDiff / 3, 1); // Normalize zoom difference

    // Combine distance and zoom factors
    return baseDuration + distanceFactor * 1.5 + zoomFactor * 0.8;
  }

  private async toggleMarkerVisibility(
    locationName: string,
    toggleElement: HTMLElement
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

    // Find the specific marker
    const marker = this.markers.find((m) => {
      const pos = m.getLatLng();
      const markerContent = m.getTooltip()?.getContent();
      if (index !== undefined) {
        // For multi-location items, match both position and index
        return markerContent?.includes(`${locationName} #${index + 1}`);
      }
      return markerContent === locationName;
    });

    if (marker) {
      const markerElement = marker.getElement();
      if (markerElement) {
        if (isVisible) {
          // Hide marker
          markerElement.style.display = "none";
          // Directly check if radius exists and is greater than 0
          if ((marker as any).uncertaintyCircle) {
            (marker as any).uncertaintyCircle.setStyle({
              opacity: 0,
              fillOpacity: 0,
            });
          }
          this.visibleMarkers.delete(markerKey);
          toggleElement.textContent = "visibility_off";
          toggleElement.classList.add("hidden");
        } else {
          // Show marker
          markerElement.style.display = "";
          // Directly check if radius exists and is greater than 0
          if ((marker as any).uncertaintyCircle) {
            (marker as any).uncertaintyCircle.setStyle({
              opacity: 0.6,
              fillOpacity: 0.2,
            });
          }
          this.visibleMarkers.add(markerKey);
          toggleElement.textContent = "visibility";
          toggleElement.classList.remove("hidden");
        }
      }
    }

    // Update category visibility state
    this.updateCategoryVisibility(toggleElement);
  }

  private async toggleCategoryVisibility(
    category: string,
    items: (Location & { type: string })[],
    toggle: HTMLElement
  ): Promise<void> {
    const isVisible = this.visibleCategories.has(category);

    if (isVisible) {
      // Hide category and all its items
      this.visibleCategories.delete(category);
      toggle.textContent = "visibility_off";
      toggle.classList.add("hidden");

      // Update all visibility toggles in this category
      const categoryElement = toggle.closest(".category");
      const allToggles =
        categoryElement?.querySelectorAll(".visibility-toggle");
      allToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility_off";
        t.classList.add("hidden");
      });

      // Remove all markers in this category from visible set
      items.forEach((item) => {
        this.visibleMarkers.delete(item.name);
        if (Array.isArray(item.coordinates[0])) {
          (item.coordinates as [number, number][]).forEach((_, index) => {
            this.visibleMarkers.delete(`${item.name}-${index}`);
          });
        }

        // Update markers visibility
        this.markers.forEach((marker) => {
          const markerName = marker
            .getTooltip()
            ?.getContent()
            .split("#")[0]
            .trim();
          if (markerName === item.name) {
            const element = marker.getElement();
            if (element) {
              element.style.display = "none";
            }
          }
        });
      });
    } else {
      // Show category and all its items
      this.visibleCategories.add(category);
      toggle.textContent = "visibility";
      toggle.classList.remove("hidden");

      // Update all visibility toggles in this category
      const categoryElement = toggle.closest(".category");
      const allToggles =
        categoryElement?.querySelectorAll(".visibility-toggle");
      allToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility";
        t.classList.remove("hidden");
      });

      // Add all markers in this category to visible set
      items.forEach((item) => {
        this.visibleMarkers.add(item.name);
        if (Array.isArray(item.coordinates[0])) {
          (item.coordinates as [number, number][]).forEach((_, index) => {
            this.visibleMarkers.add(`${item.name}-${index}`);
          });
        }

        // Update markers visibility
        this.markers.forEach((marker) => {
          const markerName = marker
            .getTooltip()
            ?.getContent()
            .split("#")[0]
            .trim();
          if (markerName === item.name) {
            const element = marker.getElement();
            if (element) {
              element.style.display = "";
            }
          }
        });
      });
    }
  }

  private async toggleMultiMarkerVisibility(
    item: Location & { type: string },
    toggle: HTMLElement
  ): Promise<void> {
    const isVisible = this.visibleMarkers.has(item.name);
    const coordinates = item.coordinates as [number, number][];

    if (isVisible) {
      // Hide main item and all child markers
      this.visibleMarkers.delete(item.name);
      toggle.textContent = "visibility_off";
      toggle.classList.add("hidden");

      // Update child toggles
      const itemElement = toggle.closest("[data-name]");
      const childToggles = itemElement?.querySelectorAll(
        ".location-item .visibility-toggle"
      );
      childToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility_off";
        t.classList.add("hidden");
      });

      // Remove individual coordinate markers from visible set
      coordinates.forEach((_, index) => {
        this.visibleMarkers.delete(`${item.name}-${index}`);
      });

      // Update marker visibility
      this.markers.forEach((marker) => {
        const markerName = marker
          .getTooltip()
          ?.getContent()
          .split("#")[0]
          .trim();
        if (markerName === item.name) {
          const element = marker.getElement();
          if (element) {
            element.style.display = "none";
          }
          // Directly check for uncertainty circle
          if ((marker as any).uncertaintyCircle) {
            (marker as any).uncertaintyCircle.setStyle({
              opacity: 0,
              fillOpacity: 0,
            });
          }
        }
      });
    } else {
      // Show main item and all child markers
      this.visibleMarkers.add(item.name);
      toggle.textContent = "visibility";
      toggle.classList.remove("hidden");

      // Update child toggles
      const itemElement = toggle.closest("[data-name]");
      const childToggles = itemElement?.querySelectorAll(
        ".location-item .visibility-toggle"
      );
      childToggles?.forEach((t) => {
        (t as HTMLElement).textContent = "visibility";
        t.classList.remove("hidden");
      });

      // Add individual coordinate markers to visible set
      coordinates.forEach((_, index) => {
        this.visibleMarkers.add(`${item.name}-${index}`);
      });

      // Update marker visibility
      this.markers.forEach((marker) => {
        const markerName = marker
          .getTooltip()
          ?.getContent()
          .split("#")[0]
          .trim();
        if (markerName === item.name) {
          const element = marker.getElement();
          if (element) {
            element.style.display = "";
          }
          // Directly check for uncertainty circle
          if ((marker as any).uncertaintyCircle) {
            (marker as any).uncertaintyCircle.setStyle({
              opacity: 0.6,
              fillOpacity: 0.2,
            });
          }
        }
      });
    }
  }

  public async addCustomMarker(
    marker: Location & { type: string }
  ): Promise<void> {
    await this.ensureInitialized();

    // Add to locations array
    this.locations.push(marker);

    // Find custom category (it should always exist)
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
      }
    }

    // Make marker visible by default
    this.visibleMarkers.add(marker.name);
    this.visibleCategories.add("custom");
  }

  private initializeElements(): void {
    // Get references to DOM elements
    this.titleEl = this.element.querySelector(".location-title") as HTMLElement;
    this.descEl = this.element.querySelector(
      ".location-description"
    ) as HTMLElement;
    this.coordEl = this.element.querySelector(
      ".coordinates-display"
    ) as HTMLElement;
    this.imgEl = this.element.querySelector(
      "#sidebar-image"
    ) as HTMLImageElement;
    this.imageModal = document.querySelector("#image-modal") as HTMLElement;
    this.modalImage = document.querySelector(
      "#modal-image"
    ) as HTMLImageElement;
    this.modalTitle = document.querySelector(".modal-title") as HTMLElement;
    this.modalDescription = document.querySelector(
      ".modal-description"
    ) as HTMLElement;
    this.closeButton = document.querySelector(".close-button") as HTMLElement;
    this.locationDrawer = this.element.querySelector(
      ".location-drawer"
    ) as HTMLElement;
  }

  private updateCategoryVisibility(toggleElement: HTMLElement): void {
    const categoryElement = toggleElement.closest(".category");
    if (!categoryElement) return;

    const category = categoryElement.getAttribute("data-category");
    if (!category) return;

    // Check if all items in category are hidden
    const itemToggles = categoryElement.querySelectorAll(".visibility-toggle");
    const allHidden = Array.from(itemToggles).every((t) =>
      t.classList.contains("hidden")
    );

    // Update category visibility toggle
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
    // Create tabs container
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "sidebar-tabs";

    // Create location tab
    const locationTab = document.createElement("button");
    locationTab.className = "sidebar-tab active";
    locationTab.innerHTML =
      '<span class="material-icons">place</span>Location Info';

    // Create drops tab
    const dropsTab = document.createElement("button");
    dropsTab.className = "sidebar-tab";
    dropsTab.innerHTML = '<span class="material-icons">inventory_2</span>Drops';

    // Get existing content containers
    const locationContent = this.element.querySelector(
      ".sidebar-content.location-info"
    ) as HTMLElement;
    const dropsContent = document.createElement("div");
    dropsContent.className = "sidebar-content drops-content";

    // Add event listeners for tabs
    tabsContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const tab = target.closest(".sidebar-tab");
      if (!tab) return;

      // Update tab states
      tabsContainer
        .querySelectorAll(".sidebar-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Update content visibility
      const isDrops = tab === dropsTab;
      locationContent.classList.toggle("active", !isDrops);
      dropsContent.classList.toggle("active", isDrops);
    });

    // Assemble tabs section
    tabsContainer.appendChild(locationTab);
    tabsContainer.appendChild(dropsTab);

    // Find the tab system container
    const tabSystem = this.element.querySelector(".tab-system") as HTMLElement;

    // Insert tabs and drops content
    tabSystem.insertBefore(tabsContainer, tabSystem.firstChild);
    tabSystem.appendChild(dropsContent);

    // Store references
    this.dropsContent = dropsContent;
    this.locationContent = locationContent;
  }

  private async toggleDropLocations(item: ItemDrop): Promise<void> {
    // Reset all markers to visible first
    this.resetMarkersVisibility();

    // Get locations that can drop this item
    const dropLocations = findDropLocations(item, this.locations);
    const dropLocationNames = new Set(dropLocations.map((l) => l.name));

    // Hide markers that don't drop this item
    this.markers.forEach((marker) => {
      const markerElement = marker.getElement();
      if (!markerElement) return;

      const markerLocation = markerElement.getAttribute("data-location");
      if (markerLocation && !dropLocationNames.has(markerLocation)) {
        markerElement.style.display = "none";
        if ((marker as any).uncertaintyCircle) {
          (marker as any).uncertaintyCircle.setStyle({
            opacity: 0,
            fillOpacity: 0,
          });
        }
      }
    });
  }

  private resetMarkersVisibility(): void {
    this.markers.forEach((marker) => {
      const markerElement = marker.getElement();
      if (!markerElement) return;

      markerElement.style.display = "";
      if ((marker as any).uncertaintyCircle) {
        (marker as any).uncertaintyCircle.setStyle({
          opacity: 0.6,
          fillOpacity: 0.2,
        });
      }
    });
  }

  private getRarityColor(rarity: string): string {
    const rarityLower = rarity.toLowerCase();
    switch (rarityLower) {
      case "common":
        return "#9e9e9e";
      case "uncommon":
        return "#4CAF50";
      case "rare":
        return "#2196F3";
      case "quest":
        return "#9C27B0";
      default:
        return "#f44336";
    }
  }

  private getLinkColor(source: string): string {
    const matchingLocation = this.locations.find(
      (loc) => loc.name.toLowerCase() === source.toLowerCase()
    );
    return (
      matchingLocation?.iconColor || (matchingLocation ? "#4CAF50" : "#9e9e9e")
    );
  }

  private async createDropsInterface(): Promise<void> {
    const drops = await loadDrops();

    Object.entries(drops).forEach(([category, items]) => {
      const categoryContainer = document.createElement("div");
      categoryContainer.className = "drops-category";

      const categoryHeader = document.createElement("div");
      categoryHeader.className = "drops-category-header";

      categoryHeader.innerHTML = `
        <div class="category-title">
          <span>${category}</span>
          <span class="item-count">(${items.length})</span>
        </div>
        <i class="fa-solid fa-chevron-down"></i>
      `;

      const itemsList = document.createElement("div");
      itemsList.className = "drops-items collapsed";

      items.forEach((item) => {
        const itemElement = document.createElement("div");
        itemElement.className = "drop-item";

        const headerElement = document.createElement("div");
        headerElement.className = "drop-header";

        // Create icon element based on icon type
        let iconHtml = "";
        if (item.icon) {
          if (item.icon.startsWith("fa-")) {
            const size = item.iconSize || 1;
            iconHtml = `<i class="${item.icon}" style="font-size: ${
              24 * size
            }px; color: ${
              item.iconColor || "#FFFFFF"
            }; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);"></i>`;
          } else {
            const size = item.iconSize || 1;
            iconHtml = `<img src="${item.icon}.svg" style="width: ${
              24 * size
            }px; height: ${24 * size}px;" alt="">`;
          }
        } else {
          // Default icon if none specified
          iconHtml = `<i class="fa-solid fa-box" style="color: ${
            item.iconColor || "#FFFFFF"
          }"></i>`;
        }

        headerElement.innerHTML = `
          <div class="drop-icon">
            ${iconHtml}
          </div>
          <div class="drop-title">${item.name}</div>
          <i class="fa-solid fa-chevron-down"></i>
        `;

        const detailsElement = document.createElement("div");
        detailsElement.className = "drop-details";
        detailsElement.innerHTML = `
          <div class="drop-description">${item.description}</div>
          <div class="drop-info-grid">
            <div class="drop-type">Type: ${item.type}</div>
            <div class="drop-rarity">
              <span class="rarity-badge" style="background-color: ${this.getRarityColor(
                item.rarity
              )}">
                ${item.rarity}
              </span>
            </div>
          </div>
          <div class="drop-sources">
            <div class="sources-title">Sources:</div>
            <div class="sources-list">
              ${item.sources
                .map((source) => {
                  const linkColor = this.getLinkColor(source);
                  const isClickable = this.locations.some(
                    (loc) =>
                      loc.name.toLowerCase() === source.toLowerCase()
                  );
                  return `
                  <a href="#" 
                     class="source-link ${isClickable ? "clickable" : ""}" 
                     data-source="${source}"
                     style="color: ${linkColor}; border-color: ${linkColor}">
                    ${source}
                  </a>`;
                })
                .join("")}
            </div>
          </div>
        `;

        // Rest of the existing code...
        itemElement.appendChild(headerElement);
        itemElement.appendChild(detailsElement);

        // Existing event listeners...
        headerElement.addEventListener("click", (e) => {
          e.stopPropagation();
          itemElement.classList.toggle("active");
          const chevron = headerElement.querySelector(".fa-chevron-down");
          if (chevron) {
            chevron.classList.toggle("rotated");
          }

          if (itemElement.classList.contains("active")) {
            itemsList.querySelectorAll(".drop-item").forEach((el) => {
              if (el !== itemElement) {
                el.classList.remove("active");
                el
                  .querySelector(".fa-chevron-down")
                  ?.classList.remove("rotated");
              }
            });
            this.toggleDropLocations(item);
          } else {
            this.resetMarkersVisibility();
          }
        });

        // Update source link click handling
        const sourcesList = detailsElement.querySelector(".sources-list");
        if (sourcesList) {
          sourcesList.addEventListener("click", (e) => {
            const link = (e.target as HTMLElement).closest(".source-link");
            if (!link || !link.classList.contains("clickable")) return;

            e.preventDefault();
            const sourceName = link.getAttribute("data-source");
            const location = this.locations.find(
              (loc) =>
                loc.name.toLowerCase() === sourceName?.toLowerCase()
            );

            if (location) {
              let coords: [number, number];
              if (Array.isArray(location.coordinates[0])) {
                // For multiple coordinates, pick a random one
                const coordsList = location.coordinates as [
                  number,
                  number
                ][];
                coords =
                  coordsList[
                    Math.floor(Math.random() * coordsList.length)
                  ];
              } else {
                coords = location.coordinates as [number, number];
              }

              const marker = this.markers.find((m) => {
                const pos = m.getLatLng();
                return pos.lat === coords[1] && pos.lng === coords[0];
              });

              if (marker) {
                this.map.setView(
                  [coords[1], coords[0]],
                  this.map.getZoom()
                );
                marker.fire("click");
              }
            }
          });
        }

        itemsList.appendChild(itemElement);
      });

      // Category collapse/expand functionality
      categoryHeader.addEventListener("click", () => {
        itemsList.classList.toggle("collapsed");
        const chevron = categoryHeader.querySelector(".fa-chevron-down");
        if (chevron) {
          chevron.classList.toggle("rotated");
        }
      });

      categoryContainer.appendChild(categoryHeader);
      categoryContainer.appendChild(itemsList);
      this.dropsContent.appendChild(categoryContainer);
    });
  }
}
