import * as L from 'leaflet';
// Import existing cloud CSS
import './clouds/clouds.css';

/**
 * CloudLayer adds atmospheric cloud effects around the edges of the map
 * Using the existing cloud structure from clouds.html
 */
export class CloudLayer {
  private map: L.Map;
  private cloudContainer: HTMLElement;
  private isActive: boolean = true;
  private initialized: boolean = false;
  private opacity: number = 0.6;
  
  constructor(map: L.Map, options?: {
    opacity?: number;
    enableOnStart?: boolean;
  }) {
    this.map = map;
    this.opacity = options?.opacity ?? 0.6;
    this.isActive = options?.enableOnStart ?? true;
    
    // Create main container
    this.cloudContainer = document.createElement('div');
    this.cloudContainer.className = 'wrap';
    
    // Initialize cloud layers
    this.initialize();
  }
  
  /**
   * Initialize the cloud effect layers using the existing structure
   */
  private initialize(): void {
    if (this.initialized) return;
    
    // Get the map container
    const mapContainer = this.map.getContainer();
    
    // Set up the cloud structure from clouds.html
    this.cloudContainer.innerHTML = `
      <div class="container">
        <div class="box">
          <div class='smoke'>
          </div>
        </div>
      </div>
    `;
    
    // Adjust styling for map integration
    this.cloudContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      pointer-events: none;
      z-index: 900;
    `;
    
    const box = this.cloudContainer.querySelector('.box') as HTMLElement;
    if (box) {
      // Make the box cover the entire map
      box.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        z-index: 900;
        box-shadow: none;
        background: transparent;
      `;
      
      // Create a clear center using a mask
      const mask = document.createElement('div');
      mask.className = 'cloud-mask';
      mask.style.cssText = `
        position: absolute;
        top: 15%;
        left: 15%;
        width: 70%;
        height: 70%;
        background: radial-gradient(
          ellipse at center,
          rgba(0, 0, 0, 1) 60%,
          rgba(0, 0, 0, 0) 100%
        );
        border-radius: 50%;
        pointer-events: none;
        z-index: 901;
        mix-blend-mode: screen;
      `;
      box.appendChild(mask);
    }
    
    // Adjust the smoke element
    const smoke = this.cloudContainer.querySelector('.smoke') as HTMLElement;
    if (smoke) {
      smoke.style.opacity = this.opacity.toString();
    }
    
    // Add the cloud container to the map
    mapContainer.appendChild(this.cloudContainer);
    
    // Listen for map movements and update layer positions
    this.map.on('move', () => this.updatePositions());
    this.map.on('resize', () => this.updatePositions());
    this.map.on('zoom', () => this.updatePositions());
    
    this.initialized = true;
    
    // Set initial visibility
    this.setVisibility(this.isActive);
    
    // Initial positioning
    this.updatePositions();
  }
  
  /**
   * Update cloud positions based on map viewport
   */
  private updatePositions(): void {
    if (!this.initialized || !this.isActive) return;
    
    // Get current map viewport dimensions
    const mapSize = this.map.getSize();
    
    // Update container dimensions
    this.cloudContainer.style.width = `${mapSize.x}px`;
    this.cloudContainer.style.height = `${mapSize.y}px`;
    
    // Update mask position to be centered with dynamic sizing
    const mask = this.cloudContainer.querySelector('.cloud-mask');
    if (mask) {
      const maxDim = Math.max(mapSize.x, mapSize.y);
      const width = Math.max(70, 100 - (2000 / maxDim));
      const height = width; // Keep it circular
      const top = (100 - height) / 2;
      const left = (100 - width) / 2;
      
      (mask as HTMLElement).style.top = `${top}%`;
      (mask as HTMLElement).style.left = `${left}%`;
      (mask as HTMLElement).style.width = `${width}%`;
      (mask as HTMLElement).style.height = `${height}%`;
    }
  }
  
  /**
   * Show/hide cloud layers
   */
  public setVisibility(visible: boolean): void {
    this.isActive = visible;
    this.cloudContainer.style.display = visible ? 'block' : 'none';
  }
  
  /**
   * Set opacity of cloud effect
   */
  public setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    
    const smoke = this.cloudContainer.querySelector('.smoke');
    if (smoke) {
      (smoke as HTMLElement).style.opacity = this.opacity.toString();
    }
  }
  
  /**
   * Clean up resources when no longer needed
   */
  public destroy(): void {
    if (this.cloudContainer.parentNode) {
      this.cloudContainer.parentNode.removeChild(this.cloudContainer);
    }
    
    // Remove event listeners
    this.map.off('move', () => this.updatePositions());
    this.map.off('resize', () => this.updatePositions());
    this.map.off('zoom', () => this.updatePositions());
    
    this.initialized = false;
  }
}
