import * as L from "leaflet";
import type { Location, ItemDrop } from "./types";
import { generateLocationHash, getRelativeDirection } from "./utils";
import { CustomMarkerService } from "./services/customMarkers";
import { loadDrops, findDropLocations } from "./drops/dropsLoader";

export interface SidebarOptions {
  element: HTMLElement;
  locations: (Location & { type: string })[];
  map: L.Map;
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
  private hasCustomCategory: boolean = false;
  private dropsContent!: HTMLElement;
  private locationContent!: HTMLElement;
  private visibilityMiddleware: SidebarOptions['visibilityMiddleware'];

  constructor(options: SidebarOptions) {
    this.element = options.element;
    this.locations = options.locations;
    this.map = options.map;
    this.markers = options.markers;
    this.customMarkerService = new CustomMarkerService();
    this.visibilityMiddleware = options.visibilityMiddleware;

    // Initialize visibility state from middleware if available
    if (this.visibilityMiddleware) {
      const hiddenMarkers = this.visibilityMiddleware.getHiddenMarkers();
      this.visibleMarkers = new Set(
        this.locations.flatMap(loc => {
          if (Array.isArray(loc.coordinates[0])) {
            const multiCoords = loc.coordinates as [number, number][];
            return multiCoords.map((_, idx) => `${loc.name}-${idx}`);
          }
          return [loc.name];
        }).filter(id => !hiddenMarkers.has(id))
      );

      const hiddenCategories = this.visibilityMiddleware.getHiddenCategories();
      this.visibleCategories = new Set(
        this.locations.map(loc => loc.type).filter(cat => !hiddenCategories.has(cat))
      );
    }

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
      } else {
        this.element.classList.add("collapsed");
        this.toggleButton.classList.add("collapsed");
        window.history.replaceState({}, "", window.location.pathname);

        document
          .querySelectorAll(".custom-location-icon.selected")
          .forEach((el) => {
            el.classList.remove("selected");
          });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        this.toggleButton.click();
      }
    });

    requestAnimationFrame(() => {
      this.toggleButton.classList.add("loaded");
      this.element.classList.add("loaded");
    });
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
    this.initializeElements();
    this.createTabInterface();
    await this.loadVisibilityState();
    await this.initializeComponentsAsync();
    await this.createDropsInterface();
    this.initialized = true;

    requestAnimationFrame(() => {
      this.element.classList.add("loaded");
      this.toggleButton.classList.add("loaded");
    });
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
          this.visibleMarkers =
            savedMarkers.size > 0 ? savedMarkers : initialVisibleMarkers;
        } else {
          this.visibleMarkers = initialVisibleMarkers;
        }

        const initialVisibleCategories = new Set(
          this.locations.map((l) => l.type)
        );
        if (categoriesJson) {
          const savedCategories = new Set(JSON.parse(categoriesJson));
          this.visibleCategories =
            savedCategories.size > 0 ? savedCategories : initialVisibleCategories;
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

  async updateContent(
    location: (Location & { type: string }) | null,
    x: number,
    y: number
  ) {
    await this.ensureInitialized();

    if (!location) {
      this.titleEl.textContent = "Current Coordinate";
      this.descEl.textContent = "No location marker at this position";
      this.coordEl.textContent = `[${Math.round(x)}, ${Math.round(y)}]`;
      this.imgEl.style.display = "none";
      this.imgEl.src = "";

      const existingIcon = this.element.querySelector(".location-icon-container");
      if (existingIcon) {
        existingIcon.remove();
      }

      const urlParams = `?coord=${Math.round(x)},${Math.round(y)}`;
      window.history.replaceState({}, "", urlParams);
    } else {
      let locationTitle = location.name;

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

      const locationInfoContainer = this.element.querySelector(
        ".location-info-container"
      );

      const existingIcon =
        locationInfoContainer?.querySelector(".location-icon-container");
      if (existingIcon) {
        existingIcon.remove();
      }

      if (location.icon || location.iconColor) {
        const iconContainer = document.createElement("div");
        iconContainer.className = "location-icon-container";

        if (location.icon) {
          const isFontAwesome =
            location.icon.startsWith("fa-") || location.icon.includes("fa-");
          const size = location.iconSize || 1;

          if (isFontAwesome) {
            const faIcon = document.createElement("i");
            faIcon.className = location.icon;
            faIcon.style.fontSize = `${32 * size}px`;
            if (location.iconColor) {
              faIcon.style.color = location.iconColor;
            }
            faIcon.style.textShadow = "2px 2px 4px rgba(0, 0, 0, 0.7)";
            iconContainer.appendChild(faIcon);
          } else {
            const standardSize = 32 * size;
            const iconImg = document.createElement("img");
            iconImg.src = `${location.icon}.svg`;
            iconImg.alt = "";
            iconImg.className = "location-icon-image";
            iconImg.style.width = `${standardSize}px`;
            iconImg.style.height = `${standardSize}px`;
            if (location.iconColor) {
              iconImg.style.filter = `drop-shadow(0 0 2px ${location.iconColor})`;
            }
            iconContainer.appendChild(iconImg);
          }
        } else if (location.iconColor) {
          const defaultIcon = document.createElement("span");
          defaultIcon.className = "material-icons default-location-icon";
          defaultIcon.textContent = "location_on";
          defaultIcon.style.color = location.iconColor;
          iconContainer.appendChild(defaultIcon);
        }

        if (locationInfoContainer) {
          locationInfoContainer.insertBefore(
            iconContainer,
            locationInfoContainer.firstChild
          );
        }
      }

      if (location.type !== "location") {
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
        this.element.querySelector(".relative-location")?.remove();
      }

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

    this.showSidebar();
  }

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

  private initializeLocationDrawer() {
    const categoriesContainer = this.element.querySelector(
      ".categories"
    ) as HTMLElement;

    const groupedLocations = this.locations.reduce((acc, location) => {
      if (!acc[location.type]) {
        acc[location.type] = [];
      }
      acc[location.type].push(location);
      return acc;
    }, {} as { [key: string]: (Location & { type: string })[] });

    this.createCategorySection(
      "custom",
      groupedLocations["custom"] || [],
      categoriesContainer
    );
    delete groupedLocations["custom"];

    Object.entries(groupedLocations).forEach(([category, items]) => {
      this.createCategorySection(category, items, categoriesContainer);
    });

    window.removeEventListener("customMarkersEmpty", () => {});
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
        iconImg.src = `${item.icon}.svg`;
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

    (item.coordinates as [number, number][]).forEach((coords, index) => {
      const locationOption = document.createElement("div");
      locationOption.className = "location-item";

      const coordSpan = document.createElement("span");
      coordSpan.className = "location-name";
      coordSpan.textContent = `#${index + 1}`;

      const coordToggle = document.createElement("span");
      coordToggle.className = "material-icons visibilityz-toggle";
      
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
        iconImg.src = `${item.icon}.svg`;
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

      const animationDuration = this.calculateAnimationDuration(distance);
      setTimeout(() => {
        marker.fire("click");
      }, animationDuration * 1000);

      const markerContent = marker.getTooltip()?.getContent() as string;
      const markerIndex = markerContent.includes("#")
        ? parseInt(markerContent.split("#")[1]) - 1
        : undefined;

      const locationHash = generateLocationHash(item.name);
      const urlParams =
        markerIndex !== undefined
          ? `?loc=${locationHash}&index=${markerIndex}`
          : `?loc=${locationHash}`;

      window.history.replaceState({}, "", urlParams);
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
    const currentZoom = this.map.getZoom();
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
          markerElement.style.display = "none";
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
          markerElement.style.display = "";
          if ((marker as any).uncertaintyCircle) {
            (marker as any).uncertaintyCircle.setStyle({
              opacity: 0.6,
              fillOpacity: 0.2,
            });
          }
          this.visibleMarkers.add(markerKey);
          toggleElement.textContent = "visibility";
          toggleElement.classList.remove("hidden");
          
          // Force marker to redraw by refreshing its position
          marker.setLatLng(marker.getLatLng());
        }
      }
    }

    if (this.visibilityMiddleware) {
      await this.visibilityMiddleware.setMarkerVisibility(markerKey, !isVisible);
    }

    this.updateCategoryVisibility(toggleElement);

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
              element.style.display = "none";

              if ((marker as any).uncertaintyCircle) {
                (marker as any).uncertaintyCircle.setStyle({
                  opacity: 0,
                  fillOpacity: 0,
                });
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
              element.style.display = "";

              if ((marker as any).uncertaintyCircle) {
                (marker as any).uncertaintyCircle.setStyle({
                  opacity: 0.6,
                  fillOpacity: 0.2,
                });
              }
              
              // Force marker to redraw by refreshing its position
              marker.setLatLng(marker.getLatLng());
            }
          }
        });
      });
    }

    if (this.visibilityMiddleware) {
      await this.visibilityMiddleware.setCategoryVisibility(category, !isVisible);

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
            element.style.display = "none";
            if ((marker as any).uncertaintyCircle) {
              (marker as any).uncertaintyCircle.setStyle({
                opacity: 0,
                fillOpacity: 0,
              });
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
            element.style.display = "";
            if ((marker as any).uncertaintyCircle) {
              (marker as any).uncertaintyCircle.setStyle({
                opacity: 0.6,
                fillOpacity: 0.2,
              });
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

    this.saveVisibilityState();
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
      }
    }

    this.visibleMarkers.add(marker.name);
    this.visibleCategories.add("custom");
  }

  private initializeElements(): void {
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
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "sidebar-tabs";

    const locationTab = document.createElement("button");
    locationTab.className = "sidebar-tab active";
    locationTab.innerHTML =
      '<span class="material-icons">place</span>Location Info';

    const dropsTab = document.createElement("button");
    dropsTab.className = "sidebar-tab";
    dropsTab.innerHTML = '<span class="material-icons">inventory_2</span>Drops';

    const locationContent = this.element.querySelector(
      ".sidebar-content.location-info"
    ) as HTMLElement;
    const dropsContent = document.createElement("div");
    dropsContent.className = "sidebar-content drops-content";

    tabsContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const tab = target.closest(".sidebar-tab");
      if (!tab) return;

      tabsContainer
        .querySelectorAll(".sidebar-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const isDrops = tab === dropsTab;
      locationContent.classList.toggle("active", !isDrops);
      dropsContent.classList.toggle("active", isDrops);
    });

    tabsContainer.appendChild(locationTab);
    tabsContainer.appendChild(dropsTab);

    const tabSystem = this.element.querySelector(".tab-system") as HTMLElement;

    tabSystem.insertBefore(tabsContainer, tabSystem.firstChild);
    tabSystem.appendChild(dropsContent);

    this.dropsContent = dropsContent;
    this.locationContent = locationContent;
  }

  private async toggleDropLocations(item: ItemDrop): Promise<void> {
    this.resetMarkersVisibility();

    const dropLocations = findDropLocations(item, this.locations);
    const dropLocationNames = new Set(dropLocations.map((l) => l.name));

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

        itemElement.appendChild(headerElement);
        itemElement.appendChild(detailsElement);

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
