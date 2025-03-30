// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import  { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';
import { initializeGrid } from './gridLoader';
import { generateLocationHash, decodeLocationHash } from './utils';
import { CustomMarkerService } from './services/customMarkers';
import { MarkerModal } from './components/MarkerModal';

let tempMarker: L.Marker | null = null;

function updateMetaTags(location: Location & { type: string }, coords: [number, number]) {
    // Update title and description meta
    document.title = `${location.name} - Soulmap`;
    const description = location.description || 'No description available';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);

    // Update Open Graph meta tags
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);
    
    // Set preview image based on priority:
    // 1. Location's imgUrl if available
    // 2. Generated icon image if Font Awesome
    // 3. Local icon if available
    let previewImage = '';
    if (location.imgUrl) {
        previewImage = location.imgUrl;
    } else if (location.icon?.startsWith('fa-')) {
        // Use Font Awesome icon with background
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            // Draw dark background
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw location name
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 48px Roboto';
            ctx.textAlign = 'center';
            ctx.fillText(location.name, canvas.width/2, canvas.height/2 - 100);
            
            // Draw coordinates
            ctx.font = '32px Roboto';
            ctx.fillText(`[${Math.round(coords[0])}, ${Math.round(coords[1])}]`, 
                canvas.width/2, canvas.height/2);
            
            previewImage = canvas.toDataURL();
        }
    } else if (location.icon) {
        // Use local icon with background
        previewImage = `${window.location.origin}${location.icon}.svg`;
    }

    // Update image meta tags if we have an image
    if (previewImage) {
        document.querySelector('meta[property="og:image"]')?.setAttribute('content', previewImage);
        document.querySelector('meta[property="twitter:image"]')?.setAttribute('content', previewImage);
    }

    // Update Twitter card meta tags
    document.querySelector('meta[property="twitter:card"]')?.setAttribute('content', 'summary_large_image');
    document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);
}

function isInBounds(coords: [number, number], bounds: L.LatLngBounds): boolean {
    // Add padding to the bounds (about 50% of the viewport size)
    const padFactor = 0.5; // 50% padding
    
    const originalBounds = bounds;
    const sw = originalBounds.getSouthWest();
    const ne = originalBounds.getNorthEast();
    
    // Calculate padding amounts
    const latPadding = (ne.lat - sw.lat) * padFactor;
    const lngPadding = (ne.lng - sw.lng) * padFactor;
    
    // Create expanded bounds
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
        // Handle location-based navigation
        targetLocation = locations.find(l => generateLocationHash(l.name) === locationParam);
        if (targetLocation) {
            targetCoords = Array.isArray(targetLocation.coordinates[0])
                ? (indexParam 
                    ? targetLocation.coordinates[parseInt(indexParam)]
                    : targetLocation.coordinates[0]) as [number, number]
                : targetLocation.coordinates as [number, number];
        }
    } else if (coordParam) {
        // Handle coordinate-based navigation
        const [x, y] = coordParam.split(',').map(Number);
        if (!isNaN(x) && !isNaN(y)) {
            targetCoords = [x, y];
            
            // Create temporary marker at the coordinates
            const latLng = L.latLng(y, x);
            createTemporaryMarker(latLng, map);
            
            // Find closest location to these coordinates
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
        // Center map and zoom
        map.setView([targetCoords[1], targetCoords[0]], 0);
        
        // Update sidebar and meta information
        sidebar.updateContent(targetLocation, targetCoords[0], targetCoords[1]);
        updateMetaTags(targetLocation, targetCoords);

        // Update URL without reloading
        const newUrl = new URL(window.location.href);
        if (locationParam) {
            newUrl.searchParams.set('loc', generateLocationHash(targetLocation.name));
            if (indexParam) newUrl.searchParams.set('index', indexParam);
        } else {
            newUrl.searchParams.set('coord', `${targetCoords[0]},${targetCoords[1]}`);
        }
        window.history.replaceState({}, '', newUrl.toString());
    } else if (targetCoords && !targetLocation) {
        // Just center the map if we have coordinates but no specific location
        map.setView([targetCoords[1], targetCoords[0]], 0);
        
        // Update sidebar with coordinate information only
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

function createTemporaryMarker(latlng: L.LatLng, map: L.Map): L.Marker {
    // Remove any existing temporary marker
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }
    
    // Use SVG file from assets directory with a larger size (2.25x)
    const pointerIcon = L.icon({
        iconUrl: './assets/SF_pointer.svg',
        iconSize: [72, 108],      // Increased from [32, 48] by 2.25x
        iconAnchor: [36, 108],    // Adjusted anchor point to match new size
        className: 'temp-marker-icon'
    });
    
    // Create and add the marker to the map
    tempMarker = L.marker(latlng, {
        icon: pointerIcon,
        zIndexOffset: 1000,  // Ensure it appears above other markers
        interactive: false   // Don't make it clickable
    }).addTo(map);
    
    return tempMarker;
}

export async function initializeMap(locations: (Location & { type: string })[], debug: boolean = false): Promise<void> {
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
        // Phase 1: Initialize map (50-60%)
        updateProgress(50, 'Initializing map...');
        const deviceType = getDeviceType();
        const defaultZoom = deviceType === 'mobile' ? -1 : 0;
        const iconSize = deviceType === 'mobile' ? [20, 20] : [30, 30];
        const map = L.map('map', {
            crs: L.CRS.Simple,
            minZoom: -3,
            maxZoom: 2,
            zoom: defaultZoom,
            // Remove or modify animation options
            zoomAnimation: false,  // Disable zoom animation
            fadeAnimation: false,  // Disable fade animation
            markerZoomAnimation: true, // Keep marker animations
            zoomDelta: 0.5,
            zoomSnap: 0.5,
            wheelPxPerZoomLevel: 120,
            maxBounds: [
                [-512, -512],
                [100352, 7680]
            ],
            maxBoundsViscosity: 1.0,
            // Add these options
            preferCanvas: true,
            renderer: L.canvas(),
            // Treat all tiles as one layer
            updateWhenZooming: false,
            updateWhenIdle: true
        });
        // Add map click handler
        map.on('click', (e: L.LeafletMouseEvent) => {
            const coords: [number, number] = [e.latlng.lng, e.latlng.lat];
            // Find closest location for sidebar display
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
            // If clicked very close to a marker, show that location
            const minDistance = 50;
            const closestDistance = Math.hypot(
                coords[0] - (Array.isArray(closest.coordinates[0]) 
                    ? closest.coordinates[0][0] 
                    : closest.coordinates[0]),
                coords[1] - (Array.isArray(closest.coordinates[0])
                    ? closest.coordinates[0][1]
                    : closest.coordinates[1])
            );
            if (closestDistance < minDistance) {
                // Update meta tags and sidebar with location
                updateMetaTags(closest, coords);
                sidebar.updateContent(closest, coords[0], coords[1]);
                // Don't update URL here as sidebar.updateContent will handle it
                // Remove any temporary marker when clicking on a real marker
                if (tempMarker) {
                    map.removeLayer(tempMarker);
                    tempMarker = null;
                }
            } else {
                // No marker at this position - create a temporary marker
                createTemporaryMarker(e.latlng, map);
                // Only update URL for coordinate clicks when not near a marker
                const urlParams = new URLSearchParams();
                urlParams.set('coord', `${Math.round(coords[0])},${Math.round(coords[1])}`);
                window.history.replaceState({}, '', `?${urlParams.toString()}`);
                // Show coordinate-only view
                sidebar.updateContent(null, coords[0], coords[1]);
            }
        });
        // Add right-click handler
        map.on('contextmenu', (e: L.LeafletMouseEvent) => {
            const coords: [number, number] = [e.latlng.lng, e.latlng.lat];
            markerModal.show(coords);
            // Remove temporary marker
            if (tempMarker) {
                map.removeLayer(tempMarker);
                tempMarker = null;
            }
        });
        // Handle new marker creation
        markerModal.onSubmit = (data) => {
            const newMarker = customMarkerService.addMarker({
                ...data,
                coordinates: data.coordinates as [number, number]
            });
            // Add marker to map and update UI
            const customLocation = { ...newMarker, type: 'custom' };
            locations.push(customLocation);
            // Force update visible markers
            updateVisibleMarkers();
            // Update existing sidebar instead of creating a new one
            sidebar.addCustomMarker(customLocation); // Add this method to Sidebar class
            // Focus on new marker
            map.setView([data.coordinates[1], data.coordinates[0]], map.getZoom());
        };
        // Load existing custom markers
        const customMarkers = customMarkerService.getAllMarkers();
        locations.push(...customMarkers.map(m => ({ ...m, type: 'custom' })));
        // Phase 2: Load grid (60-75%)
        updateProgress(60, 'Loading map tiles...');
        await initializeGrid(map);
        // Phase 3: Initialize markers (75-90%)
        updateProgress(75, 'Creating markers...');
        const markerGroup = L.layerGroup().addTo(map);
        const markers: L.Marker[] = [];
        const activeMarkers = new Set<string>();
        // Now that the map is initialized, set up the update function
        function updateVisibleMarkers() {
            const bounds = map.getBounds();
            locations.forEach(location => {
                const coords = Array.isArray(location.coordinates[0]) 
                    ? location.coordinates as [number, number][]
                    : [location.coordinates] as [number, number][];
                coords.forEach((coord, index) => {
                    const markerId = `${location.name}-${index}`;
                    const isVisible = isInBounds(coord, bounds);
                    if (isVisible && !activeMarkers.has(markerId)) {
                        // Create marker icon
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
                                iconUrl: `${location.icon}.svg`,
                                iconSize: [iconSize[0] * sizeMultiplier, iconSize[1] * sizeMultiplier],
                                iconAnchor: [iconSize[0] * sizeMultiplier / 2, iconSize[1] * sizeMultiplier / 2],
                                className: 'custom-location-icon'
                            });
                        }
                        // Create and add marker
                        const marker = L.marker([coord[1], coord[0]], { 
                            icon,
                            riseOnHover: true,
                            riseOffset: 100,
                            autoPanOnFocus: false,
                            keyboard: false,
                            // Add these options
                            snapToPixel: true,
                            zIndexOffset: 1000,
                            // Disable default animations
                            animate: false,
                            // Important: This makes markers move instantly with the map
                            renderer: L.canvas({ padding: 0.5 }),
                            // Add these options for better performance
                            pane: 'markerPane',
                            bubblingMouseEvents: false
                        });
                        marker.getElement()?.setAttribute('data-location', location.name);
                        if (coords.length > 1) {
                            marker.getElement()?.setAttribute('data-index', index.toString());
                        }
                        marker.bindTooltip(coords.length > 1 ? `${location.name} #${index + 1}` : location.name, {
                            permanent: false,
                            direction: 'top',
                            offset: [0, -30],
                            className: 'leaflet-tooltip'
                        });
                        marker.on('click', () => {
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
                        // Add uncertainty circle if radius is specified
                        if (location.radius && location.iconColor) {
                            const circle = createUncertaintyCircle(
                                coord,
                                location.radius,
                                location.iconColor
                            );
                            circle.addTo(map);
                            // Store circle reference with marker for removal
                            (marker as any).uncertaintyCircle = circle;
                        }
                        marker.addTo(markerGroup);
                        markers.push(marker);
                        activeMarkers.add(markerId);
                    } else if (!isVisible && activeMarkers.has(markerId)) {
                        // Remove out-of-bounds marker and its circle
                        const markerIndex = markers.findIndex(m => {
                            const pos = m.getLatLng();
                            return pos.lat === coord[1] && pos.lng === coord[0];
                        });
                        if (markerIndex !== -1) {
                            const marker = markers[markerIndex];
                            if ((marker as any).uncertaintyCircle) {
                                map.removeLayer((marker as any).uncertaintyCircle);
                            }
                            markerGroup.removeLayer(marker);
                            markers.splice(markerIndex, 1);
                            activeMarkers.delete(markerId);
                        }
                    }
                });
            });
        }
        // Add event listeners for map movement
        map.on('move', updateVisibleMarkers); // Add this line
        map.on('moveend', updateVisibleMarkers);
        map.on('zoom', updateVisibleMarkers);  // Add this line
        map.on('zoomend', updateVisibleMarkers);
        // Phase 4: Initialize interface (90-100%)
        updateProgress(90, 'Initializing interface...');
        // Initialize sidebar first
        const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
        const sidebar = new Sidebar({
            element: sidebarElement,
            locations,
            map,
            markers
        });
        // Handle URL navigation parameters
        await handleUrlNavigation(map, sidebar, locations, new URLSearchParams(window.location.search));
        // Initialize search after handling URL params
        initializeSearch(locations, map, markers);
        // Initial marker update after everything is ready
        updateVisibleMarkers();
        updateProgress(100, 'Ready!');
        // Hide loading overlay after a short delay
        setTimeout(() => {
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }, 500);
    } catch (error) {
        console.error('Error initializing map:', error);
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }
}
