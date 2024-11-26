import type { CustomMarker, CustomMarkerStorage, Location } from '../types';
import JSZip from 'jszip';
import yaml from 'js-yaml';

const STORAGE_KEY = 'soulmap_custom_markers';

function generateUUID(): string {
  // Use crypto.getRandomValues if available
  if (window.crypto && window.crypto.getRandomValues) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  // Fallback to Math.random()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class CustomMarkerService {
  private markers: CustomMarker[] = [];

  constructor() {
    this.loadMarkers();
  }

  private loadMarkers(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as CustomMarkerStorage;
      this.markers = data.markers;
    }
  }

  private saveMarkers(): void {
    const data: CustomMarkerStorage = {
      version: '1.0',
      markers: this.markers
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save markers:', error);
    }
  }

  public addMarker(marker: Omit<CustomMarker, 'id' | 'createdAt'>): CustomMarker {
    // Sanitize marker data and prevent duplicate names
    const name = marker.name.trim();
    if (this.markers.some(m => m.name === name)) {
        throw new Error('A marker with this name already exists');
    }

    const sanitizedMarker = {
        ...marker,
        name,
        // Ensure coordinates are in the correct format
        coordinates: Array.isArray(marker.coordinates[0]) 
            ? marker.coordinates[0] 
            : marker.coordinates as [number, number]
    };

    const newMarker: CustomMarker = {
        ...sanitizedMarker,
        id: generateUUID(),
        createdAt: Date.now()
    };

    this.markers.push(newMarker);
    this.saveMarkers();
    return newMarker;
  }

  public deleteMarker(id: string): void {
    this.markers = this.markers.filter(m => m.id !== id);
    this.saveMarkers();
    
    // If no markers left, dispatch an event to notify sidebar
    if (this.markers.length === 0) {
      window.dispatchEvent(new CustomEvent('customMarkersEmpty'));
    }
  }

  public getAllMarkers(): CustomMarker[] {
    return [...this.markers];
  }

  public exportMarkerAsYaml(id: string): string {
    const marker = this.markers.find(m => m.id === id);
    if (!marker) return '';
    
    // Format data to match standard location YAML structure
    const exportData = {
        name: marker.name,
        coordinates: [
            Math.round(marker.coordinates[0]),
            Math.round(marker.coordinates[1])
        ],
        description: marker.description || '',
        icon: marker.icon || 'fa-solid fa-thumbtack',
        iconSize: marker.iconSize || 1,
        iconColor: marker.iconColor || '#FFFFFF'
    };

    // Only add imgUrl if it exists
    if (marker.imgUrl) {
        Object.assign(exportData, { imgUrl: marker.imgUrl });
    }
    
    // Use js-yaml dump with specific options
    return yaml.dump(exportData, {
        lineWidth: -1, // Prevent line wrapping
        flowLevel: 1,  // Use flow style for arrays
        styles: {
            '!!null': 'empty' // Remove null values
        },
        noRefs: true // Prevent reference aliases
    });
  }

  public async exportAllMarkersAsZip(): Promise<Blob | null> {
    if (this.markers.length === 0) return null;

    const zip = new JSZip();
    const customFolder = zip.folder('custom-markers');
    
    this.markers.forEach(marker => {
      const { id: _, createdAt: __, ...markerData } = marker;
      const fileName = `${marker.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yml`;
      customFolder?.file(fileName, yaml.dump(markerData));
    });

    return await zip.generateAsync({ type: 'blob' });
  }
}