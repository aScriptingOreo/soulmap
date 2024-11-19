// src/types.ts
export interface Location {
  name: string;
  coordinates: [number, number] | [number, number][];
  description: string;
  icon?: string;
  iconSize?: number;
  imgUrl?: string;
  iconColor?: string; // New optional hex color property
}
export interface VersionInfo {
  version: string;
  game_version: string;
}