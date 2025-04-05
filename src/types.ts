// src/types.ts
export interface CoordinateProperties {
  coordinates: [number, number];
  description?: string;
  mediaUrl?: string | string[]; // Updated to support multiple media URLs
  icon?: string;
  iconSize?: number;
  iconColor?: string;
  radius?: number;
  lore?: string;
  spoilers?: string;
  // Any other properties that could be overridden per coordinate
}

export interface Location {
  name: string;
  coordinates: [number, number] | ([number, number] | CoordinateProperties)[];
  description: string;
  icon?: string;
  iconSize?: number;
  mediaUrl?: string | string[]; // Updated to support multiple media URLs
  iconColor?: string;
  radius?: number;
  lastModified?: number; // Timestamp of when the file was last modified
  isCoordinateSearch?: boolean; // Special flag for coordinate search results
  lore?: string; // Contains additional lore information
  spoilers?: string; // Optional spoiler content
  // Add this line to store exact coordinates for complex structures
  _exactCoordinates?: [number, number];
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