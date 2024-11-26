// src/gridLoader.ts
import * as L from 'leaflet';
import localforage from 'localforage';

export class GridLoader {
    private readonly TILE_SIZE = 512;
    private readonly GRID_WIDTH = 15;
    private readonly TOTAL_TILES = 196;
    private readonly OFFSET = 0;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000;
    private tileStore: LocalForage;

    constructor() {
        // Initialize localforage instance
        this.tileStore = localforage.createInstance({
            name: 'soulmap-tiles'
        });
    }

    private async getTileKey(imgPath: string, gameVersion: string): string {
        return `${gameVersion}:${imgPath}`;
    }

    private async loadTileWithRetry(imgPath: string, gameVersion: string, retryCount = 0): Promise<string> {
        const tileKey = await this.getTileKey(imgPath, gameVersion);

        try {
            // Try stored version first
            const storedBlob = await this.tileStore.getItem<Blob>(tileKey);
            if (storedBlob) {
                return URL.createObjectURL(storedBlob);
            }

            // Fetch with retry
            const response = await fetch(imgPath);
            if (!response.ok) {
                throw new Error(`Failed to load tile: ${response.status}`);
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            // Store the successful response
            await this.tileStore.setItem(tileKey, blob);
            return blobUrl;

        } catch (error) {
            if (retryCount < this.MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.loadTileWithRetry(imgPath, gameVersion, retryCount + 1);
            }
            throw error;
        }
    }

    public async createOverlays(map: L.Map): Promise<void> {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        try {
            const versionModule = await import('./mapversion.yml');
            const gameVersion = versionModule.default.game_version;
            const rows = Math.ceil(this.TOTAL_TILES / this.GRID_WIDTH);

            for (let i = this.OFFSET; i < this.TOTAL_TILES + this.OFFSET; i++) {
                const col = Math.floor((i - this.OFFSET) / rows);
                const row = (i - this.OFFSET) % rows;
                
                const bounds: [[number, number], [number, number]] = [
                    [row * this.TILE_SIZE, col * this.TILE_SIZE],
                    [(row + 1) * this.TILE_SIZE, (col + 1) * this.TILE_SIZE]
                ];

                const imgPath = `map/${i}.png`;
                
                try {
                    const blobUrl = await this.loadTileWithRetry(imgPath, gameVersion);
                    L.imageOverlay(blobUrl, bounds, { 
                        interactive: false,
                        className: 'map-tile'
                    }).addTo(map);

                    if (loadingOverlay) {
                        const progress = ((i + 1) / this.TOTAL_TILES) * 100;
                        const progressBar = loadingOverlay.querySelector('.loading-progress') as HTMLElement;
                        if (progressBar) {
                            progressBar.style.width = `${progress}%`;
                        }
                    }
                } catch (error) {
                    console.error(`Failed to load tile ${i}:`, error);
                }
            }
        } finally {
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }
    }

    public async clearTileCache(): Promise<void> {
        try {
            await this.tileStore.clear();
        } catch (error) {
            console.warn('Failed to clear tile cache:', error);
        }
    }
}

export async function initializeGrid(map: L.Map): Promise<void> {
    const grid = new GridLoader();
    await grid.createOverlays(map);
    
    const totalRows = Math.ceil(grid.TOTAL_TILES / grid.GRID_WIDTH);
    map.fitBounds([
        [0, 0],
        [totalRows * grid.TILE_SIZE, grid.GRID_WIDTH * grid.TILE_SIZE]
    ]);
}