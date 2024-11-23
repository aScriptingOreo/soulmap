// src/devOverlay.ts
import * as L from 'leaflet';

export class DevelopmentOverlay {
    private map: L.Map;
    private overlay: L.Polygon | null = null;
    private watermark: L.DivOverlay | null = null;

    constructor(map: L.Map) {
        this.map = map;
        
        // Create custom pane for overlay
        if (!map.getPane('devPane')) {
            const devPane = map.createPane('devPane');
            devPane.style.zIndex = '400'; // Above tiles, below UI
        }
    }

    public createOverlay(vertices: [number, number][]): void {
        // Convert vertices to [lat, lng] format and create inverted polygon
        const convertedVertices = vertices.map(([x, y]) => [y, x] as [number, number]);
        
        // Create map bounds
        const mapBounds: [number, number][] = [
            [0, 0],
            [0, 196 * 512],
            [13 * 512, 196 * 512],
            [13 * 512, 0]
        ];

        // Create polygon with hole (inverted mask)
        const overlay = L.polygon([
            mapBounds,           // Outer polygon (full map)
            convertedVertices    // Inner polygon (hole)
        ], {
            color: 'red',
            weight: 2,
            fillColor: 'red',
            fillOpacity: 0.2,
            className: 'dev-overlay',
            pane: 'devPane'
        }).addTo(this.map);

        // Add repeating text pattern
        this.addWatermarkPattern();
    }

    private addWatermarkPattern(): void {
        const container = document.createElement('div');
        container.className = 'watermark-container';
        container.innerHTML = Array(20).fill('Under Development').join(' ');
        
        const customPane = this.map.getPane('devPane');
        if (customPane) {
            customPane.appendChild(container);
        }
    }
}