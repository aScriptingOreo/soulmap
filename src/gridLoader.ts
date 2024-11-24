// src/gridLoader.ts
import * as L from 'leaflet';

export class GridLoader {
    private readonly TILE_SIZE = 512;
    private readonly GRID_WIDTH = 15;
    private readonly TOTAL_TILES = 196;
    private readonly OFFSET = 0;
    private readonly CACHE_NAME = 'map-tiles-v0.6.0'; // Match with mapversion.yml
    private readonly isCachingAvailable: boolean;

    constructor() {
        // Check if caching is available
        this.isCachingAvailable = typeof caches !== 'undefined';
    }

    private async getCachedTile(path: string): Promise<Response | undefined> {
        if (!this.isCachingAvailable) return undefined;
        
        try {
            const cache = await caches.open(this.CACHE_NAME);
            const cachedResponse = await cache.match(path);
            return cachedResponse;
        } catch (error) {
            console.warn('Cache access failed, falling back to network:', error);
            return undefined;
        }
    }

    private async cacheTile(path: string, response: Response): Promise<void> {
        if (!this.isCachingAvailable) return;
        
        try {
            const cache = await caches.open(this.CACHE_NAME);
            await cache.put(path, response.clone());
        } catch (error) {
            console.warn('Failed to cache tile:', error);
        }
    }

    private async cleanOldCaches(): Promise<void> {
        if (!this.isCachingAvailable) return;

        try {
            const cacheKeys = await caches.keys();
            const oldCaches = cacheKeys.filter(key => 
                key.startsWith('map-tiles-') && key !== this.CACHE_NAME
            );
            
            await Promise.all(oldCaches.map(key => caches.delete(key)));
        } catch (error) {
            console.warn('Failed to clean old caches:', error);
        }
    }

    public async createOverlays(map: L.Map): Promise<void> {
        // Clean old caches on initialization
        await this.cleanOldCaches();

        const rows = Math.ceil(this.TOTAL_TILES / this.GRID_WIDTH);
        
        for (let i = this.OFFSET; i < this.TOTAL_TILES + this.OFFSET; i++) {
            const col = Math.floor((i - this.OFFSET) / rows);
            const row = (i - this.OFFSET) % rows;
            
            const bounds: [[number, number], [number, number]] = [
                [row * this.TILE_SIZE, col * this.TILE_SIZE],
                [(row + 1) * this.TILE_SIZE, (col + 1) * this.TILE_SIZE]
            ];

            try {
                const imgPath = `map/${i}.png`;
                let response = await this.getCachedTile(imgPath);
                
                if (!response) {
                    response = await fetch(imgPath);
                    await this.cacheTile(imgPath, response);
                }

                if (response.ok) {
                    const blobUrl = URL.createObjectURL(await response.clone().blob());
                    L.imageOverlay(blobUrl, bounds, { 
                        interactive: false,
                        className: 'map-tile'
                    }).addTo(map);
                }
            } catch (error) {
                console.error(`Error loading tile ${i}:`, error);
            }
        }
    }
}

export async function initializeGrid(map: L.Map): Promise<void> {
    const grid = new GridLoader();
    await grid.createOverlays(map);
    
    // Set bounds for the entire map
    const totalRows = Math.ceil(grid.TOTAL_TILES / grid.GRID_WIDTH);
    map.fitBounds([
        [0, 0],
        [totalRows * grid.TILE_SIZE, grid.GRID_WIDTH * grid.TILE_SIZE]
    ]);
}