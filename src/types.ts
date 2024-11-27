// src/types.ts
export interface Location {
  name: string;
  coordinates: [number, number] | [number, number][];
  description: string;
  icon?: string;
  iconSize?: number;
  imgUrl?: string;
  iconColor?: string;
  radius?: number;
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