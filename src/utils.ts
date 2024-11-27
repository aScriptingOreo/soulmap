import type { Location } from './types';

export function generateLocationHash(name: string): string {
  return name.toLowerCase()
             .replace(/[^a-z0-9]+/g, '-')
             .replace(/(^-|-$)/g, '');
}

export function decodeLocationHash(hash: string, locations: (Location & { type: string })[]): Location & { type: string } | undefined {
  return locations.find(l => generateLocationHash(l.name) === hash);
}

export function getRelativeDirection(from: [number, number], to: [number, number]): string {
    const [x1, y1] = from; // Location marker coordinates
    const [x2, y2] = to;   // Target coordinates
    
    // Calculate angle FROM the reference point TO the target
    // Invert the difference to get correct direction
    const angle = Math.atan2(-(y2 - y1), -(x2 - x1)) * (180 / Math.PI);
    
    // Convert angle to 8-point compass direction
    const directions = ['East', 'North-East', 'North', 'North-West', 'West', 'South-West', 'South', 'South-East'];
    const index = Math.round(((angle + 180) % 360) / 45);
    return directions[index % 8];
}