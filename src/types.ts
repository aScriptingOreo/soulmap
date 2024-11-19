// src/types.ts
export interface Location {
  name: string;
  coordinates: [number, number] | [number, number][]; // Single or multiple coordinates
  description: string;
  icon?: string; // Optional Font Awesome icon class
  iconSize?: number; // Optional size multiplier for the icon
}