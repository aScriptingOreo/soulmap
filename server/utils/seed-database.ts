import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { Location as LocationType } from '../../src/types';

// Initialize PrismaClient
const prisma = new PrismaClient();

// Import from YAML files
async function importFromYamlFiles(): Promise<{ count: number; errors: number }> {
  try {
    console.log('Starting YAML file import...');
    
    const baseDir = path.resolve(__dirname, '../../src/locations');
    if (!fs.existsSync(baseDir)) {
      console.log(`Locations directory not found at ${baseDir}`);
      return { count: 0, errors: 0 };
    }
    
    let importCount = 0;
    let errorCount = 0;
    
    // Get all location type directories
    const typeDirectories = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    console.log(`Found ${typeDirectories.length} location type directories`);
    
    // Process each type directory
    for (const type of typeDirectories) {
      const typeDir = path.join(baseDir, type);
      const files = fs.readdirSync(typeDir)
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
      
      console.log(`Found ${files.length} YAML files in ${type} directory`);
      
      for (const file of files) {
        try {
          const filePath = path.join(typeDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const locationData = yaml.load(content) as LocationType & { type?: string };
          
          if (!locationData || !locationData.name) {
            console.warn(`Invalid location data in ${file}, skipping`);
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
          
          // Process coordinates based on format
          let coordinates;
          let isComplex = false;
          
          if (!locationData.coordinates) {
            console.warn(`No coordinates found for ${locationData.name}, using default`);
            coordinates = [0, 0]; // Default coordinates
          }
          else if (
            Array.isArray(locationData.coordinates) && 
            locationData.coordinates.length === 2 && 
            typeof locationData.coordinates[0] === 'number'
          ) {
            // Single coordinate pair like [x, y]
            console.log(`Processing simple coordinate for ${locationData.name}: [${locationData.coordinates}]`);
            coordinates = locationData.coordinates;
          }
          else if (Array.isArray(locationData.coordinates) && locationData.coordinates.length > 0) {
            // Check if this is a complex location with custom properties per coordinate
            if (
              typeof locationData.coordinates[0] === 'object' && 
              !Array.isArray(locationData.coordinates[0]) &&
              (locationData.coordinates[0] as any).coordinates
            ) {
              // Complex location with per-coordinate properties like tuvalkane.yml
              console.log(`Processing complex location with ${locationData.coordinates.length} points: ${locationData.name}`);
              isComplex = true;
              
              // For complex locations, we'll store the whole array but process each point separately
              coordinates = locationData.coordinates;
              
              // Create a separate Location entity for each coordinate
              for (let i = 0; i < locationData.coordinates.length; i++) {
                const point = locationData.coordinates[i] as any;
                
                if (!point.coordinates || !Array.isArray(point.coordinates)) {
                  console.warn(`Invalid coordinate format at index ${i} for complex location ${locationData.name}`);
                  continue;
                }
                
                await prisma.location.create({
                  data: {
                    name: `${locationData.name} - Point ${i + 1}`,
                    coordinates: point.coordinates,
                    description: point.description || locationData.description || '',
                    type: type,
                    icon: point.icon || locationData.icon,
                    iconSize: point.iconSize || locationData.iconSize,
                    mediaUrl: point.mediaUrl ? 
                      (Array.isArray(point.mediaUrl) ? point.mediaUrl : [point.mediaUrl]) : 
                      (locationData.mediaUrl ? 
                        (Array.isArray(locationData.mediaUrl) ? locationData.mediaUrl : [locationData.mediaUrl]) : 
                        undefined),
                    iconColor: point.iconColor || locationData.iconColor,
                    radius: point.radius || locationData.radius,
                    lore: point.lore || locationData.lore,
                    spoilers: point.spoilers || locationData.spoilers,
                    lastModified: new Date(),
                    // Store reference to parent location
                    submittedBy: locationData.name, // Use name field to track relationship
                  }
                });
                
                console.log(`Created complex location point ${i + 1} for ${locationData.name}`);
                importCount++;
              }
            }
            else if (Array.isArray(locationData.coordinates[0])) {
              // Array of simple coordinate pairs like camps.yml
              console.log(`Processing location with ${locationData.coordinates.length} coordinate pairs: ${locationData.name}`);
              coordinates = locationData.coordinates;
            }
            else {
              console.warn(`Unrecognized coordinates format in ${file}, using first point`);
              coordinates = Array.isArray(locationData.coordinates[0]) ? 
                locationData.coordinates[0] : [0, 0];
            }
          }
          else {
            console.warn(`Invalid coordinates format in ${file}, using default`);
            coordinates = [0, 0]; // Default coordinates
          }
          
          // Skip creating the main record for complex locations since we created individual points
          if (!isComplex) {
            // Create location in database
            await prisma.location.create({
              data: {
                name: locationData.name,
                coordinates: coordinates,
                description: locationData.description || '',
                type: type,
                icon: locationData.icon,
                iconSize: locationData.iconSize,
                mediaUrl: locationData.mediaUrl ? 
                  (Array.isArray(locationData.mediaUrl) ? locationData.mediaUrl : [locationData.mediaUrl]) : 
                  undefined,
                iconColor: locationData.iconColor,
                radius: locationData.radius,
                lore: locationData.lore,
                spoilers: locationData.spoilers,
                lastModified: new Date()
              }
            });
            
            console.log(`Created location: ${locationData.name}`);
            importCount++;
          }
        } catch (fileError) {
          console.error(`Error importing file ${file}:`, fileError);
          errorCount++;
        }
      }
    }
    
    console.log(`Import summary: ${importCount} locations imported, ${errorCount} errors encountered.`);
    return { count: importCount, errors: errorCount };
  } catch (error) {
    console.error('Error importing from YAML files:', error);
    return { count: 0, errors: 1 };
  }
}

// Main function to seed the database
async function seedDatabase() {
  try {
    console.log('Checking if database needs seeding...');
    
    // Check if there are any locations in the database
    const locationCount = await prisma.location.count();
    console.log(`Current location count: ${locationCount}`);
    
    if (locationCount > 0) {
      console.log('Database already has locations, no seeding needed');
      return;
    }
    
    console.log('Database is empty, starting seeding process...');
    
    // Import from YAML files
    const { count, errors } = await importFromYamlFiles();
    
    if (count === 0) {
      console.log('No locations were imported from YAML files.');
      console.log('Seeding minimal default locations instead.');
      
      // Create some minimal default locations if import failed completely
      await prisma.location.create({
        data: {
          name: 'Starting Area',
          coordinates: [500, 500],
          description: 'Default starting area for new players.',
          type: 'location',
          icon: 'fa-solid fa-flag',
          iconColor: '#4CAF50',
          lastModified: new Date()
        }
      });
      
      await prisma.location.create({
        data: {
          name: 'Central Hub',
          coordinates: [1000, 1000],
          description: 'Central gathering area with important NPCs.',
          type: 'location',
          icon: 'fa-solid fa-city',
          iconColor: '#2196F3',
          lastModified: new Date()
        }
      });
      
      console.log('Created 2 default locations');
    }
    
    console.log('Database seeding completed successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding function
console.log('Starting database seeding...');
seedDatabase()
  .then(() => {
    console.log('Seeding process finished');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error in seeding process:', error);
    process.exit(1);
  });
