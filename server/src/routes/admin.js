import express from 'express';
import db from '#db';  // Use database wrapper for consistent handling

console.log('Admin router file loaded.');

const router = express.Router();

// Add middleware to log all requests to this router
router.use((req, res, next) => {
  console.log(`Admin route hit: ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * Get all unique location categories
 */
router.get('/categories', async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    // Use Prisma findMany with distinct for better type safety and reliability
    const uniqueCategoryObjects = await prisma.location.findMany({
      distinct: ['type'],
      select: {
        type: true,
      },
      orderBy: {
        type: 'asc',
      },
    });
    
    // Extract the type values from the results WITHOUT modifying them
    const categories = uniqueCategoryObjects.map(item => item.type);
    
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * Get a single location by ID
 */
router.get('/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const location = await prisma.location.findUnique({
      where: { id },
    });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    res.json(location);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

/**
 * Create a new location
 */
router.post('/locations', async (req, res) => {
  console.log('POST /locations handler reached.'); // Add this log
  // Ensure coordinates are handled correctly
  const { coordinates, ...restData } = req.body; 
  
  const data = { ...restData };

  // Handle coordinates based on your schema (assuming JSON for flexibility)
  if (coordinates && Array.isArray(coordinates)) {
     data.coordinates = coordinates; 
  } else {
     // Provide a default if coordinates are missing or invalid
     data.coordinates = [[0, 0]]; 
  }

  // Add default values or handle missing optional fields if necessary
  data.iconSize = data.iconSize ?? 1;
  data.iconColor = data.iconColor ?? '#ffffff';
  data.radius = data.radius ?? 0;
  data.mediaUrl = data.mediaUrl ?? [];
  data.isCoordinateSearch = data.isCoordinateSearch ?? false;
  data.noCluster = data.noCluster ?? false;
  data.exactCoordinates = data.exactCoordinates ?? null;
  // You might want to set submittedBy/approvedBy based on the authenticated user here

  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const newLocation = await prisma.location.create({
      data,
    });
    console.log('Location created successfully:', newLocation.id); // Add success log
    res.status(201).json(newLocation); // Use 201 Created status
  } catch (error) {
    console.error('Error creating location:', error.message || error); 
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * Create a new location (dedicated endpoint)
 */
router.post('/locations/new', async (req, res) => {
  console.log('POST /locations/new handler reached.'); // Log for debugging
  
  // Ensure coordinates are handled correctly
  const { coordinates, ...restData } = req.body; 
  
  const data = { ...restData };

  // Handle coordinates based on your schema
  if (coordinates && Array.isArray(coordinates)) {
     data.coordinates = coordinates; 
  } else {
     // Provide a default if coordinates are missing or invalid
     data.coordinates = [[0, 0]]; 
  }

  // Add default values or handle missing optional fields
  data.iconSize = data.iconSize ?? 1;
  data.iconColor = data.iconColor ?? '#ffffff';
  data.radius = data.radius ?? 0;
  data.mediaUrl = data.mediaUrl ?? [];
  data.isCoordinateSearch = data.isCoordinateSearch ?? false;
  data.noCluster = data.noCluster ?? false;
  data.exactCoordinates = data.exactCoordinates ?? null;
  
  try {
    console.log('Creating new location with data:', data);
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const newLocation = await prisma.location.create({
      data,
    });
    console.log('Location created successfully:', newLocation.id);
    res.status(201).json(newLocation);
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * Update a location by ID
 */
router.put('/locations/:id', async (req, res) => {
  const { id } = req.params;
  // Ensure coordinates are handled correctly if they are part of the update
  const { coordinates, ...restData } = req.body; 
  
  const data = { ...restData };

  // Prisma expects coordinates in a specific format if it's a Point type.
  // If your schema uses simple arrays or JSON, adjust accordingly.
  // Assuming 'coordinates' might be sent and needs potential transformation:
  if (coordinates && Array.isArray(coordinates)) {
     // If your schema expects a JSON field or similar:
     // data.coordinates = coordinates; 
     
     // If your schema expects separate lat/lon or x/y fields, map them here.
     // Example for separate fields:
     // if (coordinates.length === 2) {
     //   data.latitude = coordinates[1]; // Assuming [lon, lat] or [x, y]
     //   data.longitude = coordinates[0];
     // }
     
     // If using PostGIS Point type, Prisma might handle array directly or need specific structure.
     // Consult Prisma docs for your specific database type (e.g., PostGIS).
     // For now, let's assume it's handled directly or stored as JSON/Array
     data.coordinates = coordinates; 
  }

  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const updatedLocation = await prisma.location.update({
      where: { id },
      data,
    });
    res.json(updatedLocation);
  } catch (error) {
    // Log the specific Prisma error if available
    console.error('Error updating location:', error.message || error); 
    // Check for specific Prisma errors like P2025 (Record not found)
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Location not found for update' });
    }
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * Delete a location by ID
 */
router.delete('/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    await prisma.location.delete({
      where: { id },
    });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

export default router;
