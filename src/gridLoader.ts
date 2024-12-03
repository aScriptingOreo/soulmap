// src/gridLoader.ts
import * as L from 'leaflet';
import localforage from 'localforage';
import { generateMapTilesHash } from './services/hashService';

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
            name: 'soulmap-tiles',
            description: 'Cache for map tiles'
        });
    }

    public async initialize(): Promise<void> {
        await this.tileStore.ready();
        return;
    }

    private async getTileKey(imgPath: string, contentHash: string): string {
        return `${contentHash}:${imgPath}`;
    }

    private async loadTileWithRetry(imgPath: string, contentHash: string, retryCount = 0): Promise<string> {
        const tileKey = await this.getTileKey(imgPath, contentHash);

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
                return this.loadTileWithRetry(imgPath, contentHash, retryCount + 1);
            }
            throw error;
        }
    }

    public async createOverlays(map: L.Map): Promise<void> {
        let loadingOverlay = document.getElementById('loading-overlay');
        const updateProgress = (progress: number) => {
            if (loadingOverlay) {
                const progressBar = loadingOverlay.querySelector('.loading-progress') as HTMLElement;
                const percentageText = loadingOverlay.querySelector('.loading-percentage') as HTMLElement;
                if (progressBar && percentageText) {
                    progressBar.style.width = `${progress}%`;
                    percentageText.textContent = `${Math.round(progress)}%`;
                }
            }
        };

        try {
            const contentHash = await generateMapTilesHash();
            const rows = Math.ceil(this.TOTAL_TILES / this.GRID_WIDTH);

            // Load tiles in smaller chunks for better progress feedback
            const chunkSize = 10;
            for (let i = this.OFFSET; i < this.TOTAL_TILES + this.OFFSET; i += chunkSize) {
                const chunk = Array.from({ length: Math.min(chunkSize, this.TOTAL_TILES - i) }, (_, j) => i + j);
                
                await Promise.all(chunk.map(async (tileIndex) => {
                    const col = Math.floor((tileIndex - this.OFFSET) / rows);
                    const row = (tileIndex - this.OFFSET) % rows;
                    
                    const bounds: [[number, number], [number, number]] = [
                        [row * this.TILE_SIZE, col * this.TILE_SIZE],
                        [(row + 1) * this.TILE_SIZE, (col + 1) * this.TILE_SIZE]
                    ];

                    const imgPath = `map/${tileIndex}.png`;
                    
                    try {
                        const blobUrl = await this.loadTileWithRetry(imgPath, contentHash);
                        L.imageOverlay(blobUrl, bounds, { 
                            interactive: false,
                            className: 'map-tile'
                        }).addTo(map);

                        const progress = ((tileIndex + 1) / this.TOTAL_TILES) * 100;
                        updateProgress(progress);
                    } catch (error) {
                        console.error(`Failed to load tile ${tileIndex}:`, error);
                    }
                }));
            }
        } finally {
            // Don't hide overlay here - let the main initialization handle it
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

// Export this function to be used in index.ts
export async function clearTileCache(): Promise<void> {
    const tileStore = localforage.createInstance({
        name: 'soulmap-tiles',
        description: 'Cache for map tiles'
    });
    
    try {
        await tileStore.clear();
    } catch (error) {
        console.warn('Failed to clear tile cache:', error);
    }
}

export async function initializeGrid(map: L.Map): Promise<void> {
    const grid = new GridLoader();
    await grid.initialize(); // Add initialization step
    await grid.createOverlays(map);
    
    const totalRows = Math.ceil(grid.TOTAL_TILES / grid.GRID_WIDTH);
    map.fitBounds([
        [0, 0],
        [totalRows * grid.TILE_SIZE, grid.GRID_WIDTH * grid.TILE_SIZE]
    ]);
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}