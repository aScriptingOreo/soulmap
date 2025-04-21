import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

/**
 * Get all unique location categories
 */
router.get('/categories', async (req, res) => {
  try {
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
    
    // Extract the type values from the results
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
