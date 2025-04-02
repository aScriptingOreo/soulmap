// src/types.ts
export interface Location {
  name: string;
  coordinates: [number, number] | [number, number][];
  description: string;
  icon?: string;
  iconSize?: number;
  mediaUrl?: string; // Renamed from mediaUrl - can now be an image or YouTube video URL
  iconColor?: string;
  radius?: number;
  lastModified?: number; // Timestamp of when the file was last modified
  isCoordinateSearch?: boolean; // Special flag for coordinate search results
  lore?: string; // Contains additional lore information
}

export interface VersionInfo {
  version: string;
  game_version: string;
}

export interface CustomMarker extends Location {
  id: string;  // Unique identifier for the custom marker
  createdAt: number;  // Timestamp
}

export interface CustomMarkerStorage {
  version: string;
  markers: CustomMarker[];
}