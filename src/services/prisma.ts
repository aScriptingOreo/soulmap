import { PrismaClient } from '@prisma/client';
import type { Location } from '../types';

// Create a singleton Prisma client instance
const prisma = new PrismaClient();

// Connect to the database
prisma.$connect()
  .then(() => console.log('Connected to database'))
  .catch(e => console.error('Database connection error:', e));

// Function to translate Prisma location record to application Location type
export function translateDbLocationToAppLocation(dbLocation: any): Location & { type: string } {
  // Parse JSON fields
  const coordinates = dbLocation.coordinates as any;
  const mediaUrl = dbLocation.mediaUrl as (string | string[] | null);
  
  // Create the location object with required fields
  const location: Location & { type: string } = {
    name: dbLocation.name,
    coordinates: coordinates,
    description: dbLocation.description,
    type: dbLocation.type,
    lastModified: dbLocation.lastModified.getTime()
  };
  
  // Add optional fields if they exist in the database record
  if (dbLocation.icon) location.icon = dbLocation.icon;
  if (dbLocation.iconSize) location.iconSize = dbLocation.iconSize;
  if (mediaUrl) location.mediaUrl = mediaUrl;
  if (dbLocation.iconColor) location.iconColor = dbLocation.iconColor;
  if (dbLocation.radius) location.radius = dbLocation.radius;
  if (dbLocation.isCoordinateSearch) location.isCoordinateSearch = dbLocation.isCoordinateSearch;
  if (dbLocation.lore) location.lore = dbLocation.lore;
  if (dbLocation.spoilers) location.spoilers = dbLocation.spoilers;
  if (dbLocation._exactCoordinates) location._exactCoordinates = dbLocation._exactCoordinates as [number, number];
  if (dbLocation.noCluster) location.noCluster = dbLocation.noCluster;
  
  return location;
}

// Set up PostgreSQL LISTEN/NOTIFY for real-time updates
export async function setupChangeListener(callback: () => Promise<void>) {
  try {
    // Use raw query to set up PostgreSQL LISTEN
    await prisma.$executeRaw`LISTEN location_changes`;
    
    // Access the underlying pg client
    const client = (prisma as any)._engine.client;
    if (client) {
      client.on('notification', async (msg: any) => {
        if (msg.channel === 'location_changes' && callback) {
          await callback();
        }
      });
    }
    
    console.log('Database change listener initialized');
  } catch (error) {
    console.error('Failed to set up database change listener:', error);
  }
}

// Function to notify about location changes
export async function notifyLocationChange() {
  try {
    await prisma.$executeRaw`NOTIFY location_changes`;
  } catch (error) {
    console.error('Failed to notify about location changes:', error);
  }
}

// Load all locations from the database
export async function loadLocationsFromDb(): Promise<(Location & { type: string })[]> {
  try {
    const dbLocations = await prisma.location.findMany();
    return dbLocations.map(translateDbLocationToAppLocation);
  } catch (error) {
    console.error('Error loading locations from database:', error);
    return [];
  }
}

// Clean up function for application shutdown
export async function disconnectPrisma() {
  await prisma.$disconnect();
}

export default prisma;
