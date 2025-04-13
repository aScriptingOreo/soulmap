/**
 * Script to migrate existing YAML location files to PostgreSQL database
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Initialize Prisma client
const prisma = new PrismaClient();

// Base directory for location files
const BASE_DIR = path.resolve(__dirname, '../src/locations');

async function migrateLocations() {
  console.log('Starting migration of locations to database...');
  
  // Get all location type directories
  const typeDirectories = fs.readdirSync(BASE_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  console.log(`Found ${typeDirectories.length} location types:`, typeDirectories);
  
  let totalLocations = 0;
  let successCount = 0;
  let errorCount = 0;
  
  // Process each type directory
  for (const type of typeDirectories) {
    const typeDir = path.join(BASE_DIR, type);
    const files = fs.readdirSync(typeDir)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
    
    console.log(`Processing ${files.length} files in ${type}...`);
    totalLocations += files.length;
    
    // Process all files in this type
    for (const file of files) {
      try {
        const filePath = path.join(typeDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const locationData = yaml.load(content) as any;
        
        // Skip if no name
        if (!locationData.name) {
          console.warn(`Skipping ${file}: No name property`);
          errorCount++;
          continue;
        }
        
        // Check if location already exists
        const existingLocation = await prisma.location.findFirst({
          where: { name: locationData.name }
        });
        
        if (existingLocation) {
          console.log(`Location ${locationData.name} already exists, skipping`);
          continue;
        }
        
        // Process coordinates to ensure they're in the right format
        let coordinates = locationData.coordinates;
        if (!Array.isArray(coordinates)) {
          coordinates = [[0, 0]]; // Default if missing
          console.warn(`Warning: Invalid coordinates format in ${file}, using default`);
        } else if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
          // Single coordinate pair like [x, y]
          coordinates = [coordinates];
        }
        
        // Create location in database
        await prisma.location.create({
          data: {
            name: locationData.name,
            coordinates,
            description: locationData.description || '',
            type,
            icon: locationData.icon,
            iconSize: locationData.iconSize,
            mediaUrl: locationData.mediaUrl ? 
              (Array.isArray(locationData.mediaUrl) ? locationData.mediaUrl : [locationData.mediaUrl]) : 
              undefined,
            iconColor: locationData.iconColor,
            radius: locationData.radius,
            lore: locationData.lore,
            spoilers: locationData.spoilers,
            lastModified: new Date(fs.statSync(filePath).mtime)
          }
        });
        
        successCount++;
        
        // Log progress periodically
        if (successCount % 10 === 0) {
          console.log(`Processed ${successCount}/${totalLocations} locations...`);
        }
      } catch (error) {
        console.error(`Error processing ${file}:`, error);
        errorCount++;
      }
    }
  }
  
  console.log('\nMigration completed:');
  console.log(`- Total locations: ${totalLocations}`);
  console.log(`- Successfully migrated: ${successCount}`);
  console.log(`- Errors: ${errorCount}`);
}

// Run the migration
migrateLocations()
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    // Disconnect Prisma client
    await prisma.$disconnect();
    console.log('Done');
  });
