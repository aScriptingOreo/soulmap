import express from 'express';
import db from '#db';

const router = express.Router();

console.log('Heatmap router file loaded.');

/**
 * Get all heatmap datapoints
 * Optionally filter by type
 */
router.get('/datapoints', async (req, res) => {
  try {
    const { typeId, visible } = req.query;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    let where = {};
    
    // Add filters if provided
    if (typeId) {
      where.types = {
        some: {
          typeId: parseInt(typeId, 10)
        }
      };
    }

    if (visible !== undefined) {
      where.visible = visible === 'true';
    }

    const datapoints = await prisma.heatmapDatapoint.findMany({
      where,
      include: {
        types: {
          include: {
            type: true
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      }
    });

    // Transform the output to a more convenient format
    const transformedDatapoints = datapoints.map(dp => ({
      id: dp.id,
      lat: dp.lat,
      intensity: dp.intensity,
      weight: dp.weight,
      radius: dp.radius,
      timestamp: dp.timestamp,
      lastModified: dp.lastModified,
      visible: dp.visible,
      types: dp.types.map(t => ({
        id: t.type.id,
        name: t.type.name,
        intensity: t.type.intensity,
        colorBindings: t.type.colorBindings
      }))
    }));

    res.json(transformedDatapoints);
  } catch (error) {
    console.error('Error fetching heatmap datapoints:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap datapoints' });
  }
});

/**
 * Get a single heatmap datapoint by ID
 */
router.get('/datapoints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const datapoint = await prisma.heatmapDatapoint.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        types: {
          include: {
            type: true
          }
        }
      }
    });

    if (!datapoint) {
      return res.status(404).json({ error: 'Heatmap datapoint not found' });
    }

    // Transform to a more convenient format
    const transformedDatapoint = {
      id: datapoint.id,
      lat: datapoint.lat,
      intensity: datapoint.intensity,
      weight: datapoint.weight,
      radius: datapoint.radius,
      timestamp: datapoint.timestamp,
      lastModified: datapoint.lastModified,
      visible: datapoint.visible,
      types: datapoint.types.map(t => ({
        id: t.type.id,
        name: t.type.name,
        intensity: t.type.intensity,
        colorBindings: t.type.colorBindings
      }))
    };

    res.json(transformedDatapoint);
  } catch (error) {
    console.error('Error fetching heatmap datapoint:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap datapoint' });
  }
});

/**
 * Create a new heatmap datapoint
 */
router.post('/datapoints', async (req, res) => {
  try {
    const { lat, intensity, weight, radius, visible, typeIds } = req.body;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    // Validate required fields
    if (!lat || !weight || !Array.isArray(typeIds) || typeIds.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields. Required: lat, weight, and at least one typeId' 
      });
    }

    // Create datapoint with type connections
    const newDatapoint = await prisma.heatmapDatapoint.create({
      data: {
        lat,
        intensity: intensity ?? 0.75,
        weight,
        radius: radius ?? 25,
        visible: visible ?? true,
        types: {
          create: typeIds.map(typeId => ({
            type: {
              connect: { id: parseInt(typeId, 10) }
            }
          }))
        }
      },
      include: {
        types: {
          include: {
            type: true
          }
        }
      }
    });

    // Transform to a more convenient format
    const transformedDatapoint = {
      id: newDatapoint.id,
      lat: newDatapoint.lat,
      intensity: newDatapoint.intensity,
      weight: newDatapoint.weight,
      radius: newDatapoint.radius,
      timestamp: newDatapoint.timestamp,
      lastModified: newDatapoint.lastModified,
      visible: newDatapoint.visible,
      types: newDatapoint.types.map(t => ({
        id: t.type.id,
        name: t.type.name,
        intensity: t.type.intensity,
        colorBindings: t.type.colorBindings
      }))
    };

    res.status(201).json(transformedDatapoint);
  } catch (error) {
    console.error('Error creating heatmap datapoint:', error);
    res.status(500).json({ error: 'Failed to create heatmap datapoint' });
  }
});

/**
 * Update a heatmap datapoint
 */
router.put('/datapoints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, intensity, weight, radius, visible, typeIds } = req.body;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const datapointId = parseInt(id, 10);

    // Start a transaction to handle updating the many-to-many relationship
    const updatedDatapoint = await prisma.$transaction(async (tx) => {
      // Delete existing relationships
      if (typeIds && Array.isArray(typeIds)) {
        await tx.heatmapDatapointType.deleteMany({
          where: { datapointId }
        });
      }

      // Update the datapoint
      const datapoint = await tx.heatmapDatapoint.update({
        where: { id: datapointId },
        data: {
          ...(lat !== undefined && { lat }),
          ...(intensity !== undefined && { intensity }),
          ...(weight !== undefined && { weight }),
          ...(radius !== undefined && { radius }),
          ...(visible !== undefined && { visible }),
          // Create new relationships if typeIds is provided
          ...(typeIds && Array.isArray(typeIds) && {
            types: {
              create: typeIds.map(typeId => ({
                type: {
                  connect: { id: parseInt(typeId, 10) }
                }
              }))
            }
          })
        },
        include: {
          types: {
            include: {
              type: true
            }
          }
        }
      });

      return datapoint;
    });

    // Transform to a more convenient format
    const transformedDatapoint = {
      id: updatedDatapoint.id,
      lat: updatedDatapoint.lat,
      intensity: updatedDatapoint.intensity,
      weight: updatedDatapoint.weight,
      radius: updatedDatapoint.radius,
      timestamp: updatedDatapoint.timestamp,
      lastModified: updatedDatapoint.lastModified,
      visible: updatedDatapoint.visible,
      types: updatedDatapoint.types.map(t => ({
        id: t.type.id,
        name: t.type.name,
        intensity: t.type.intensity,
        colorBindings: t.type.colorBindings
      }))
    };

    res.json(transformedDatapoint);
  } catch (error) {
    console.error('Error updating heatmap datapoint:', error);
    
    // Check for Prisma not found error
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Heatmap datapoint not found for update' });
    }
    
    res.status(500).json({ error: 'Failed to update heatmap datapoint' });
  }
});

/**
 * Delete a heatmap datapoint
 */
router.delete('/datapoints/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    await prisma.heatmapDatapoint.delete({
      where: { id: parseInt(id, 10) }
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting heatmap datapoint:', error);
    
    // Check for Prisma not found error
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Heatmap datapoint not found for deletion' });
    }
    
    res.status(500).json({ error: 'Failed to delete heatmap datapoint' });
  }
});

/**
 * Get all heatmap types
 */
router.get('/types', async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const types = await prisma.heatmapType.findMany({
      orderBy: {
        name: 'asc'
      }
    });

    res.json(types);
  } catch (error) {
    console.error('Error fetching heatmap types:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap types' });
  }
});

/**
 * Get a single heatmap type by ID
 */
router.get('/types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const type = await prisma.heatmapType.findUnique({
      where: { id: parseInt(id, 10) }
    });

    if (!type) {
      return res.status(404).json({ error: 'Heatmap type not found' });
    }

    res.json(type);
  } catch (error) {
    console.error('Error fetching heatmap type:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap type' });
  }
});

/**
 * Create a new heatmap type
 */
router.post('/types', async (req, res) => {
  try {
    const { name, intensity, colorBindings } = req.body;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newType = await prisma.heatmapType.create({
      data: {
        name,
        intensity,
        colorBindings
      }
    });

    res.status(201).json(newType);
  } catch (error) {
    console.error('Error creating heatmap type:', error);
    
    // Check for unique constraint error
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A heatmap type with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create heatmap type' });
  }
});

/**
 * Update a heatmap type
 */
router.put('/types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, intensity, colorBindings } = req.body;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    const updatedType = await prisma.heatmapType.update({
      where: { id: parseInt(id, 10) },
      data: {
        ...(name !== undefined && { name }),
        ...(intensity !== undefined && { intensity }),
        ...(colorBindings !== undefined && { colorBindings })
      }
    });

    res.json(updatedType);
  } catch (error) {
    console.error('Error updating heatmap type:', error);
    
    // Check for Prisma not found error
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Heatmap type not found for update' });
    }
    
    // Check for unique constraint error
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A heatmap type with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update heatmap type' });
  }
});

/**
 * Delete a heatmap type
 */
router.delete('/types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = await db.getPrismaClient();
    
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }

    await prisma.heatmapType.delete({
      where: { id: parseInt(id, 10) }
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting heatmap type:', error);
    
    // Check for Prisma not found error
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Heatmap type not found for deletion' });
    }
    
    res.status(500).json({ error: 'Failed to delete heatmap type' });
  }
});

/**
 * Get heatmap configuration
 */
router.get('/config', async (req, res) => {
  try {
    // You can expand this to get configuration from database if needed
    res.json({
      enabled: true,
      defaultOpacity: 0.6,
      defaultRadius: 25,
      defaultIntensity: 0.75,
      maxWeight: 254,
      defaultColorScheme: 'heat'
    });
  } catch (error) {
    console.error('Error fetching heatmap configuration:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap configuration' });
  }
});

export default router;
