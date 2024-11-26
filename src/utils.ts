import type { Location } from './types';

export function generateLocationHash(name: string): string {
  return name.toLowerCase()
             .replace(/[^a-z0-9]+/g, '-')
             .replace(/(^-|-$)/g, '');
}

export function decodeLocationHash(hash: string, locations: (Location & { type: string })[]): Location & { type: string } | undefined {
  return locations.find(l => generateLocationHash(l.name) === hash);
}