// src/map.ts
import * as L from 'leaflet';
import type { Location, VersionInfo } from './types';
import { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';
import { initializeGrid } from './gridLoader';
import { generateLocationHash, decodeLocationHash } from './utils';
import { CustomMarkerService } from './services/customMarkers';
import { MarkerModal } from './components/MarkerModal';
import mapVersion from './mapversion.yml';
import analytics from './analytics';
// Import clustering helpers
import { prepareLocationsForClustering, getLocationTypeGroups, determineClusterIcon } from './loader';
// Add visibility middleware import
import {
  initVisibilityMiddleware,
  isMarkerVisible,
  setMarkerVisibility,
  setCategoryVisibility,
  getHiddenMarkers,
  getHiddenCategories
} from './services/visibilityMiddleware';

// Make tempMarker accessible globally to share between modules
export let tempMarker: L.Marker | null = null;
// Add a flag to track if map initialization succeeded
export let mapInitialized = false;
// Create a global reference to the map
export let mainMap: L.Map | null = null;
// Create a global reference to markers 
export let markers: L.Marker[] = [];

// Add this declaration to extend the Leaflet namespace
declare global {
  namespace L {
    function markerClusterGroup(options?: any): any;
  }
}

// Modify the getIconUrl function to handle offline mode more gracefully
function getIconUrl(iconPath: string): string {
  if (/^(https?:\/\/)/.test(iconPath)) {
    return iconPath;
  }

  const normalizedPath = iconPath.startsWith('/') ? iconPath : `/${iconPath}`;
  const pathWithoutExtension = normalizedPath.replace(/\.svg$/, '');
  const versionInfo = mapVersion as VersionInfo;
  const cacheBuster = versionInfo?.version?.replace(/\./g, '') || '';
  return `${pathWithoutExtension}.svg?v=${cacheBuster}`;
}

// Export updateMetaTags for use in search.ts
export function updateMetaTags(location: Location & { type: string } | null, coords: [number, number]) {
  // First validate coords to avoid issues with undefined or malformed coordinates
  if (!coords || !Array.isArray(coords) || coords.length !== 2) {
    console.warn("updateMetaTags called with invalid coordinates", coords);
    document.title = "Soulmap";
    return;
  }

  // Format coordinates for display
  const x = Math.round(coords[0]);
  const y = Math.round(coords[1]);

  if (!location) {
    // Special handling for coordinate-only display
    document.title = `Coordinates [${x}, ${y}] - Soulmap`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', 
        `Viewing coordinates [${x}, ${y}] in Soulmap.`);
    
    // Update OpenGraph metadata too
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', 
        `Coordinates [${x}, ${y}] - Soulmap`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', 
        `Exploring coordinates [${x}, ${y}] in Soulmap.`);
    
    document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', 
        `Coordinates [${x}, ${y}] - Soulmap`);
    document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', 
        `Exploring coordinates [${x}, ${y}] in Soulmap.`);
    return;
  }

  // Location-based meta tags
  document.title = `${location.name} - Soulmap`;
  const description = location.description || 'No description available';
  document.querySelector('meta[name="description"]')?.setAttribute('content', 
      `${location.name} - Located at [${x}, ${y}]. ${description}`);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', 
      `${location.name} - Soulmap`);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', 
      `${location.name} - Located at [${x}, ${y}]. ${description}`);
  
  let previewImage = '';
  if (location.imgUrl) {
      previewImage = location.imgUrl;
  } else if (location.icon?.startsWith('fa-')) {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 630;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 48px Roboto';
          ctx.textAlign = 'center';
          ctx.fillText(location.name, canvas.width/2, canvas.height/2 - 100);
          ctx.font = '32px Roboto';
          ctx.fillText(`[${x}, ${y}]`, 
              canvas.width/2, canvas.height/2);
          previewImage = canvas.toDataURL();
      }
  } else if (location.icon) {
      previewImage = `${window.location.origin}${location.icon}.svg`;
  }

  if (previewImage) {
      document.querySelector('meta[property="og:image"]')?.setAttribute('content', previewImage);
      document.querySelector('meta[property="twitter:image"]')?.setAttribute('content', previewImage);
  }

  document.querySelector('meta[property="twitter:card"]')?.setAttribute('content', 'summary_large_image');
  document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', 
      `${location.name} - Soulmap`);
  document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', 
      `${location.name} - Located at [${x}, ${y}]. ${description}`);
}

function isInBounds(coords: [number, number], bounds: L.LatLngBounds): boolean {
  const padFactor = 0.5;
  const originalBounds = bounds;
  const sw = originalBounds.getSouthWest();
  const ne = originalBounds.getNorthEast();
  const latPadding = (ne.lat - sw.lat) * padFactor;
  const lngPadding = (ne.lng - sw.lng) * padFactor;
  const paddedBounds = L.latLngBounds(
      L.latLng(sw.lat - latPadding, sw.lng - lngPadding),
      L.latLng(ne.lat + latPadding, ne.lng + lngPadding)
  );

  return paddedBounds.contains([coords[1], coords[0]]);
}

async function handleUrlNavigation(
  map: L.Map,
  sidebar: Sidebar,
  locations: (Location & { type: string })[],
  urlParams: URLSearchParams
): Promise<void> {
  const locationParam = urlParams.get('loc');
  const coordParam = urlParams.get('coord');
  const indexParam = urlParams.get('index');

  let targetLocation: (Location & { type: string }) | undefined;
  let targetCoords: [number, number] | undefined;

  if (locationParam) {
      targetLocation = locations.find(l => generateLocationHash(l.name) === locationParam);
      if (targetLocation) {
          targetCoords = Array.isArray(targetLocation.coordinates[0])
              ? (indexParam 
                  ? targetLocation.coordinates[parseInt(indexParam)]
                  : targetLocation.coordinates[0]) as [number, number]
              : targetLocation.coordinates as [number, number];
      }
  } else if (coordParam) {
      const [x, y] = coordParam.split(',').map(Number);
      if (!isNaN(x) && !isNaN(y)) {
          targetCoords = [x, y];
          const latLng = L.latLng(y, x);
          createTemporaryMarker(latLng, map);
          targetLocation = locations.reduce((closest, loc) => {
              const locCoords = Array.isArray(loc.coordinates[0]) 
                  ? loc.coordinates[0] 
                  : loc.coordinates as [number, number];
              const currentDist = Math.hypot(x - locCoords[0], y - locCoords[1]);
              const closestDist = closest ? Math.hypot(
                  x - (Array.isArray(closest.coordinates[0]) 
                      ? closest.coordinates[0][0] 
                      : closest.coordinates[0]),
                  y - (Array.isArray(closest.coordinates[0])
                      ? closest.coordinates[0][1]
                      : closest.coordinates[1])
              ) : Infinity;

              return currentDist < closestDist ? loc : closest;
          });
      }
  }

  if (targetCoords && targetLocation) {
      map.setView([targetCoords[1], targetCoords[0]], 0);
      sidebar.updateContent(targetLocation, targetCoords[0], targetCoords[1]);
      updateMetaTags(targetLocation, targetCoords);
      const newUrl = new URL(window.location.href);
      if (locationParam) {
          newUrl.searchParams.set('loc', generateLocationHash(targetLocation.name));
          if (indexParam) newUrl.searchParams.set('index', indexParam);
      } else {
          newUrl.searchParams.set('coord', `${targetCoords[0]},${targetCoords[1]}`);
      }
      window.history.replaceState({}, '', newUrl.toString());
  } else if (targetCoords && !targetLocation) {
      map.setView([targetCoords[1], targetCoords[0]], 0);
      sidebar.updateContent(null, targetCoords[0], targetCoords[1]);
  }
}

function createUncertaintyCircle(coord: [number, number], radius: number, color: string): L.Circle {
  const darkerColor = color.startsWith('#') 
      ? color.replace(/[^#]/g, x => {
          const val = parseInt(x, 16);
          return Math.max(0, val - 2).toString(16);
        })
      : color;

  return L.circle([coord[1], coord[0]], {
      radius: radius,
      color: darkerColor,
      fillColor: color,
      fillOpacity: 0.2,
      opacity: 0.6,
      weight: 2,
      interactive: false
  });
}

export function createTemporaryMarker(latlng: L.LatLng, map: L.Map): L.Marker | null {
  if (!map) {
    console.warn("Cannot create temporary marker: map is not initialized");
    return null;
  }
  
  if (tempMarker) {
    try {
      map.removeLayer(tempMarker);
    } catch (e) {
      console.warn("Error removing temporary marker:", e);
    }
  }
  
  try {
    const pointerIcon = L.icon({
        iconUrl: './assets/SF_pointer.svg',
        iconSize: [72, 108],
        iconAnchor: [36, 108],
        className: 'temp-marker-icon protected-icon'
    });
    
    tempMarker = L.marker(latlng, {
        icon: pointerIcon,
        zIndexOffset: 1000,
        interactive: false
    }).addTo(map);
    
    const markerElement = tempMarker.getElement();
    if (markerElement) {
        markerElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
    }
    
    return tempMarker;
  } catch (e) {
    console.error("Error creating temporary marker:", e);
    return null;
  }
}

export function removeTemporaryMarker(map: L.Map | null): void {
  if (!map) {
    console.warn("Cannot remove temporary marker: map is not initialized");
    return;
  }
  
  if (tempMarker) {
    try {
      map.removeLayer(tempMarker);
      tempMarker = null;
    } catch (e) {
      console.warn("Error removing temporary marker:", e);
    }
  }
}

function saveVisibilityState(markerId: string, visible: boolean, category?: string): void {
  if (category) {
      setCategoryVisibility(category, visible);
  } else {
      setMarkerVisibility(markerId, visible);
  }
}

export async function initializeMap(locations: (Location & { type: string })[], debug: boolean = false): Promise<L.Map | null> {
  const progressBar = document.querySelector('.loading-progress') as HTMLElement;
  const percentageText = document.querySelector('.loading-percentage') as HTMLElement;
  const loadingText = document.querySelector('.loading-text') as HTMLElement;
  const loadingOverlay = document.getElementById('loading-overlay');
  const updateProgress = (progress: number, text: string) => {
      if (progressBar && percentageText && loadingText) {
          progressBar.style.width = `${progress}%`;
          percentageText.textContent = `${Math.round(progress)}%`;
          loadingText.textContent = text;
      }
  };
  const customMarkerService = new CustomMarkerService();
  const markerModal = new MarkerModal();
  
  try {
      await initVisibilityMiddleware();

      updateProgress(50, 'Initializing map...');
      const deviceType = getDeviceType();
      const defaultZoom = deviceType === 'mobile' ? -1 : 0;
      const iconSize = deviceType === 'mobile' ? [20, 20] : [30, 30];
      const map = L.map('map', {
          crs: L.CRS.Simple,
          minZoom: -3,
          maxZoom: 2,
          zoom: defaultZoom,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: true,
          zoomDelta: 0.5,
          zoomSnap: 0.5,
          wheelPxPerZoomLevel: 120,
          maxBounds: [
              [-512, -512],
              [100352, 7680]
          ],
          maxBoundsViscosity: 1.0,
          preferCanvas: true,
          renderer: L.canvas(),
          updateWhenZooming: false,
          updateWhenIdle: true
      });

      // Store reference to the map globally
      mainMap = map;

      // Set up map click and right-click handlers
      map.on('click', (e: L.LeafletMouseEvent) => {
          const coords: [number, number] = [e.latlng.lng, e.latlng.lat];
          const closest = locations.reduce((closest, loc) => {
              const locCoords = Array.isArray(loc.coordinates[0]) 
                  ? loc.coordinates[0] 
                  : loc.coordinates as [number, number];
              const currentDist = Math.hypot(
                  coords[0] - locCoords[0],
                  coords[1] - locCoords[1]
              );
              const closestDist = closest ? Math.hypot(
                  coords[0] - (Array.isArray(closest.coordinates[0]) 
                      ? closest.coordinates[0][0] 
                      : closest.coordinates[0]),
                  coords[1] - (Array.isArray(closest.coordinates[0])
                      ? closest.coordinates[0][1]
                      : closest.coordinates[1])
              ) : Infinity;
              return currentDist < closestDist ? loc : closest;
          });
          
          // Make the minimum distance dynamic based on zoom level
          // Higher zoom (more zoomed in) = smaller detection radius
          const currentZoom = map.getZoom();
          const baseDistance = 50;
          const zoomFactor = Math.pow(0.6, currentZoom); // Exponential reduction as zoom increases
          const minDistance = baseDistance * zoomFactor;
          
          const closestDistance = Math.hypot(
              coords[0] - (Array.isArray(closest.coordinates[0]) 
                  ? closest.coordinates[0][0] 
                  : closest.coordinates[0]),
              coords[1] - (Array.isArray(closest.coordinates[0])
                  ? closest.coordinates[0][1]
                  : closest.coordinates[1])
          );
          
          if (closestDistance < minDistance) {
              analytics.trackLocationView(closest.name, closest.type);
              updateMetaTags(closest, coords);
              sidebar.updateContent(closest, coords[0], coords[1]);
              if (tempMarker) {
                  map.removeLayer(tempMarker);
                  tempMarker = null;
              }
          } else {
              analytics.trackEvent('coordinate_click', {
                  x: Math.round(coords[0]),
                  y: Math.round(coords[1])
              });
              createTemporaryMarker(e.latlng, map);
              
              // Make sure coords is always a valid array with 2 elements
              const validCoords: [number, number] = [
                  Math.round(coords[0] * 1000) / 1000, 
                  Math.round(coords[1] * 1000) / 1000
              ];
              
              updateMetaTags(null, validCoords);
              
              // Find the nearest named location for reference
              const nearestLocation = locations
                  .filter(loc => loc.type === 'location')
                  .reduce((nearest, loc) => {
                      const locCoords = Array.isArray(loc.coordinates[0]) 
                          ? loc.coordinates[0] 
                          : loc.coordinates as [number, number];
                      const currentDist = Math.hypot(
                          coords[0] - locCoords[0],
                          coords[1] - locCoords[1]
                      );
                      const nearestDist = nearest ? Math.hypot(
                          coords[0] - (Array.isArray(nearest.coordinates[0]) 
                              ? nearest.coordinates[0][0] 
                              : nearest.coordinates[0]),
                          coords[1] - (Array.isArray(nearest.coordinates[0])
                              ? nearest.coordinates[0][1]
                              : nearest.coordinates[1])
                      ) : Infinity;
                      return currentDist < nearestDist ? loc : nearest;
                  }, null as (Location & { type: string }) | null);
                  
              // THIS WAS THE MISSING LINE - update sidebar with coordinate info
              sidebar.updateContent(null, coords[0], coords[1], nearestLocation);
          }
      });

      map.on('contextmenu', (e: L.LeafletMouseEvent) => {
          const coords: [number, number] = [e.latlng.lng, e.latlng.lat];
          markerModal.show(coords);
          if (tempMarker) {
              map.removeLayer(tempMarker);
              tempMarker = null;
          }
      });

      // Set up marker modal submission handler
      markerModal.onSubmit = (data) => {
          const newMarker = customMarkerService.addMarker({
              ...data,
              coordinates: data.coordinates as [number, number]
          });
          const customLocation = { ...newMarker, type: 'custom' };
          locations.push(customLocation);
          updateVisibleMarkers();
          sidebar.addCustomMarker(customLocation);
          map.setView([data.coordinates[1], data.coordinates[0]], map.getZoom());
          sidebar.updateContent(customLocation, data.coordinates[0], data.coordinates[1]);
          const locationHash = generateLocationHash(customLocation.name);
          window.history.replaceState({}, '', `?loc=${locationHash}`);
          updateMetaTags(customLocation, data.coordinates);
      };

      // Add custom markers to locations
      const customMarkers = customMarkerService.getAllMarkers();
      locations.push(...customMarkers.map(m => ({ ...m, type: 'custom' })));

      updateProgress(60, 'Loading map tiles...');
      await initializeGrid(map);

      updateProgress(75, 'Creating markers...');

      const { clusterable, unclustered } = prepareLocationsForClustering(locations);
      const locationTypes = getLocationTypeGroups(locations);

      let markerClusterGroup: any;

      try {
          markerClusterGroup = L.layerGroup().addTo(map);
      } catch (e) {
          console.error("Error initializing marker group:", e);
          markerClusterGroup = L.layerGroup().addTo(map);
      }

      const regularMarkerGroup = L.layerGroup().addTo(map);
      markers = []; // Store in the exported array
      const activeMarkers = new Set<string>();

      function updateVisibleMarkers() {
          const bounds = map.getBounds();
          
          // Clear markers that are out of bounds
          markers.forEach((marker, index) => {
              const pos = marker.getLatLng();
              const isInView = bounds.contains(pos);
              if (!isInView && marker.getElement()) {
                  // Remove marker and its uncertainty circle if out of bounds
                  if ((marker as any).uncertaintyCircle) {
                      map.removeLayer((marker as any).uncertaintyCircle);
                  }
                  const markerId = marker.options.markerId;
                  if (markerId) {
                      activeMarkers.delete(markerId);
                  }
                  const targetGroup = (marker as any).options.clusterGroup ? markerClusterGroup : regularMarkerGroup;
                  targetGroup.removeLayer(marker);
                  markers.splice(index, 1);
              }
          });
          
          locations.forEach(location => {
              const coords = Array.isArray(location.coordinates[0]) 
                  ? location.coordinates as [number, number][]
                  : [location.coordinates] as [number, number][];
              
              const shouldCluster = !location.noCluster && 
                                typeof L.markerClusterGroup === 'function' &&
                                markerClusterGroup.addLayer;
              const targetGroup = shouldCluster ? markerClusterGroup : regularMarkerGroup;
              
              coords.forEach((coord, index) => {
                  const markerId = `${location.name}-${index}`;
                  const isVisible = isInBounds(coord, bounds);
                  
                  // Check visibility from middleware first
                  const shouldBeVisible = isVisible && isMarkerVisible(markerId, location.type);
                  
                  if (shouldBeVisible && !markers.some(m => {
                      const pos = m.getLatLng();
                      return pos.lat === coord[1] && pos.lng === coord[0];
                  })) {
                      let icon: L.Icon | L.DivIcon;
                      if (location.icon && location.icon.startsWith('fa-')) {
                          const sizeMultiplier = location.iconSize || 1;
                          icon = L.divIcon({
                              className: 'custom-location-icon',
                              html: `<i class="${location.icon}" style="font-size: ${iconSize[0] * sizeMultiplier}px; color: ${location.iconColor || '#FFFFFF'}; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);"></i>`,
                              iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
                              iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2]
                          });
                      } else {
                          const sizeMultiplier = location.iconSize || 1;
                          icon = L.icon({
                              iconUrl: getIconUrl(location.icon || ''),
                              iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
                              iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2],
                              className: 'custom-location-icon protected-icon'
                          });
                      }
                      
                      const marker = L.marker([coord[1], coord[0]], { 
                          icon,
                          riseOnHover: true,
                          riseOffset: 100,
                          autoPanOnFocus: false,
                          keyboard: false,
                          locationData: location,
                          markerId: markerId, // Store marker ID for easier identification
                          clusterGroup: shouldCluster // Store whether this marker should be clustered
                      });
                      
                      // Add uncertainty circle if location has radius
                      if (location.radius && location.radius > 0) {
                          const uncertaintyCircle = createUncertaintyCircle(
                              coord, 
                              location.radius, 
                              location.iconColor || '#3388ff'
                          );
                          uncertaintyCircle.addTo(map);
                          (marker as any).uncertaintyCircle = uncertaintyCircle;
                          
                          // Set initial visibility based on marker visibility state
                          if (!isMarkerVisible(markerId, location.type)) {
                            const circleElement = uncertaintyCircle._path;
                            if (circleElement) {
                              circleElement.classList.add("circle-hidden");
                            } else {
                              uncertaintyCircle.setStyle({
                                opacity: 0,
                                fillOpacity: 0
                              });
                            }
                          }
                      }
                      
                      marker.bindTooltip(coords.length > 1 ? `${location.name} #${index + 1}` : location.name, {
                          permanent: false,
                          direction: 'top',
                          offset: [0, -30],
                          className: 'leaflet-tooltip'
                      });
                      
                      marker.on('click', () => {
                          analytics.trackLocationView(location.name, location.type);
                          sidebar.updateContent(location, coord[0], coord[1]);
                          document.querySelectorAll('.custom-location-icon.selected').forEach(el => {
                              el.classList.remove('selected');
                          });
                          marker.getElement()?.classList.add('selected');
                          const locationHash = generateLocationHash(location.name);
                          const urlParams = coords.length > 1 ? 
                              `?loc=${locationHash}&index=${index}` : 
                              `?loc=${locationHash}`;
                          window.history.replaceState({}, '', urlParams);
                          updateMetaTags(location, coord);
                      });
                      
                      // Set initial visibility state based on middleware
                      if (!isMarkerVisible(markerId, location.type)) {
                          const el = marker.getElement();
                          if (el) {
                              el.classList.add("marker-hidden");
                          }
                      }
                      
                      marker.addTo(targetGroup);
                      markers.push(marker);
                      activeMarkers.add(markerId);
                  }
              });
          });
      }

      map.on('move', updateVisibleMarkers);
      map.on('moveend', updateVisibleMarkers);
      map.on('zoom', updateVisibleMarkers);
      map.on('zoomend', updateVisibleMarkers);

      // Important: Initialize the sidebar BEFORE search and URL navigation
      updateProgress(90, 'Initializing interface...');
      const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
      const sidebar = new Sidebar({
          element: sidebarElement,
          locations,
          map,
          markers,
          visibilityMiddleware: {
              isMarkerVisible,
              setMarkerVisibility,
              setCategoryVisibility,
              getHiddenMarkers,
              getHiddenCategories
          }
      });
      
      // Store sidebar reference to window for global access
      (window as any).sidebarInstance = sidebar;
      
      // Initialize search with properly populated markers array
      initializeSearch(locations, map, markers);
      
      // Handle URL navigation after sidebar and search are initialized
      await handleUrlNavigation(map, sidebar, locations, new URLSearchParams(window.location.search));
      
      // Make sure markers are created and displayed
      updateVisibleMarkers();
      
      // Add an additional call after a short delay to ensure markers display
      setTimeout(() => {
          updateVisibleMarkers();
      }, 1000);

      updateProgress(100, 'Ready!');
      setTimeout(() => {
          if (loadingOverlay) {
              loadingOverlay.style.display = 'none';
          }
      }, 500);

      // At the end of successful initialization
      mapInitialized = true;
      return map;
  } catch (error) {
      console.error('Error initializing map:', error);
      if (loadingOverlay) {
          loadingOverlay.style.display = 'none';
      }
      
      // Display an error message to users
      const mapContainer = document.getElementById('map');
      if (mapContainer) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'map-error-message';
        errorDiv.innerHTML = `
          <div style="padding: 20px; background: rgba(0,0,0,0.7); color: white; border-radius: 10px; text-align: center;">
            <h3>Map initialization failed</h3>
            <p>The map could not be loaded. You can still use the search and sidebar features.</p>
            <small>Error: ${error?.message || 'Unknown error'}</small>
          </div>
        `;
        mapContainer.appendChild(errorDiv);
      }
      
      // Return null to indicate map failed to initialize
      return null;
  }
}

// Helper function to update marker visibility using the class-based approach
export function updateMarkerVisibility(markerId: string, visible: boolean): void {
    const marker = markers.find(m => m.options.markerId === markerId);
    if (marker) {
        const el = marker.getElement();
        if (el) {
            if (visible) {
                el.classList.remove("marker-hidden");
            } else {
                el.classList.add("marker-hidden");
            }
        }
        
        // Also update the uncertainty circle if it exists
        if ((marker as any).uncertaintyCircle) {
            const circleElement = (marker as any).uncertaintyCircle._path;
            if (circleElement) {
                if (visible) {
                    circleElement.classList.remove("circle-hidden");
                } else {
                    circleElement.classList.add("circle-hidden");
                }
            } else {
                (marker as any).uncertaintyCircle.setStyle({
                    opacity: visible ? 0.6 : 0,
                    fillOpacity: visible ? 0.2 : 0
                });
            }
        }
    }
}

// Add a helper function to get the map
export function getMap(): L.Map | null {
  return mainMap;
}

// Extend window interface
declare global {
    interface Window {
        _clusterRefreshTimeout?: number;
    }
}
