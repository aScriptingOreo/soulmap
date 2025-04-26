import express from 'express';
import db from '#db';  // Use #db instead of relative import

const router = express.Router();

console.log('Locations router file loaded.');

// Get all locations
router.get('/', async (req, res) => {
  try {
    const locations = await db.getAllLocations();
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// Get location by ID - use regular parameter to avoid conflict with other routes
router.get('/:id', async (req, res) => {
  try {
    const location = await db.getLocationById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    res.json(location);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

// Get database hash
router.get('/hash', async (req, res) => {
  try {
    const hash = await db.generateDatabaseHash();
    res.json({ hash });
  } catch (error) {
    console.error('Error generating database hash:', error);
    res.status(500).json({ error: 'Failed to generate hash', hash: `error-server-${Date.now()}` });
  }
});

// Get individual location hashes
router.get('/hashes', async (req, res) => {
  try {
    const prisma = await db.getPrismaClient();
    if (!prisma) {
      return res.status(500).json({ error: 'Failed to connect to database' });
    }
    
    const locations = await prisma.location.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        lastModified: true
      }
    });
    
    // Create a map of location name to hash
    const hashes = {};
    
    // Define disable marker constant
    const DISABLED_MARKER = '![DISABLED]';
    
    locations.forEach(location => {
      // Don't include disabled locations in the hashes
      if (!location.type?.includes(DISABLED_MARKER)) {
        hashes[location.name] = location.lastModified?.getTime().toString() || Date.now().toString();
      }
    });
    
    res.json({ hashes });
  } catch (error) {
    console.error('Error generating marker hashes:', error);
    res.status(500).json({ error: 'Failed to generate marker hashes' });
  }
});

export default router;
