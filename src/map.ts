// src/map.ts
import * as L from 'leaflet';
import type { Location } from './types';
import { getDeviceType } from './device';
import { initializeSearch } from './search';
import { Sidebar } from './sidebar';
import { initializeGrid } from './gridLoader';
import { generateLocationHash, decodeLocationHash } from './utils';

function updateMetaTags(location: Location & { type: string }, coords: [number, number]) {
    // Update title
    document.title = `${location.name} - Soulmap`;

    // Update meta description
    const description = location.description || 'No description available';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);

    // Update Open Graph meta tags
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);

    // Set image based on location type
    let imageUrl;
    if (location.imgUrl) {
        imageUrl = location.imgUrl;
    } else if (location.icon?.startsWith('fa-')) {
        // Generate Font Awesome icon image URL
        const iconClass = location.icon.replace('fa-solid ', '');
        imageUrl = `https://fa-icons.com/${iconClass}.svg`;
    } else if (location.icon) {
        // Use self-hosted icon
        const baseUrl = window.location.origin;
        imageUrl = `${baseUrl}${location.icon}.svg`;
    }

    if (imageUrl) {
        document.querySelector('meta[property="og:image"]')?.setAttribute('content', imageUrl);
        document.querySelector('meta[property="twitter:image"]')?.setAttribute('content', imageUrl);
    }

    // Update Twitter card meta tags
    document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', 
        `${location.name} - Soulmap`);
    document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', 
        `${location.name} - Located at [${coords[0]}, ${coords[1]}]. ${description}`);
}

function isInBounds(coords: [number, number], bounds: L.LatLngBounds): boolean {
    return bounds.contains([coords[1], coords[0]]);
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

    try {
        // Phase 1: Initialize map (50-60%)
        updateProgress(50, 'Initializing map...');
        
        const deviceType = getDeviceType();
        const defaultZoom = deviceType === 'mobile' ? -1 : 0;
        const iconSize = deviceType === 'mobile' ? [20, 20] : [30, 30];
        const zoomedViewZoom = 0;

        const map = L.map('map', {
            crs: L.CRS.Simple,
            minZoom: -3,
            maxZoom: 2,
            zoom: defaultZoom,
            zoomDelta: 0.5,
            zoomSnap: 0.5,
            wheelPxPerZoomLevel: 120,
            maxBounds: [
                [-512, -512],
                [100352, 7680]
            ],
            maxBoundsViscosity: 1.0
        });

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
                        const marker = L.marker([coord[1], coord[0]], { icon });
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
        
                        marker.addTo(markerGroup);
                        markers.push(marker);
                        activeMarkers.add(markerId);
                    } else if (!isVisible && activeMarkers.has(markerId)) {
                        // Remove out-of-bounds marker
                        const markerIndex = markers.findIndex(m => {
                            const pos = m.getLatLng();
                            return pos.lat === coord[1] && pos.lng === coord[0];
                        });
                        if (markerIndex !== -1) {
                            markerGroup.removeLayer(markers[markerIndex]);
                            markers.splice(markerIndex, 1);
                            activeMarkers.delete(markerId);
                        }
                    }
                });
            });
        }

        // Add event listeners for map movement
        map.on('moveend', updateVisibleMarkers);
        map.on('zoomend', updateVisibleMarkers);

        // Phase 4: Initialize interface (90-100%)
        updateProgress(90, 'Initializing interface...');
        
        // Initialize search and sidebar
        initializeSearch(locations, map, markers);
        const sidebarElement = document.querySelector('.right-sidebar') as HTMLElement;
        const sidebar = new Sidebar({
            element: sidebarElement,
            locations,
            map,
            markers
        });

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