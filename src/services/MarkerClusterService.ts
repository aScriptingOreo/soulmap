import * as L from 'leaflet';

/**
 * Simple marker group that doesn't do any clustering
 * Just acts as a wrapper around L.layerGroup for API consistency
 */
export class MarkerClusterGroup extends L.LayerGroup {
  options: any;
  
  constructor(options: any = {}) {
    super();
    this.options = options;
  }

  // Maintain the same API but without actual clustering
  refreshClusters(): this {
    return this;
  }
  
  addLayers(layers: L.Layer[]): this {
    layers.forEach(layer => this.addLayer(layer));
    return this;
  }
  
  removeLayers(layers: L.Layer[]): this {
    layers.forEach(layer => this.removeLayer(layer));
    return this;
  }
  
  getChildCount(): number {
    return this.getLayers().length;
  }
}

export function markerClusterGroup(options?: any): MarkerClusterGroup {
  return new MarkerClusterGroup(options);
}
