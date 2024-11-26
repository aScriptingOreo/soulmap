// src/gridLoader.ts
import * as L from 'leaflet';

export class GridLoader {
    private readonly TILE_SIZE = 512;
    private readonly GRID_WIDTH = 15;
    private readonly TOTAL_TILES = 196;
    private readonly OFFSET = 0;

    public async createOverlays(map: L.Map): Promise<void> {
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
                const response = await fetch(imgPath);

                if (response.ok) {
                    const blobUrl = URL.createObjectURL(await response.blob());
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
    
    const totalRows = Math.ceil(grid.TOTAL_TILES / grid.GRID_WIDTH);
    map.fitBounds([
        [0, 0],
        [totalRows * grid.TILE_SIZE, grid.GRID_WIDTH * grid.TILE_SIZE]
    ]);
}