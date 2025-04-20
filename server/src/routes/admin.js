import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

/**
 * Get all unique location categories
 */
router.get('/categories', async (req, res) => {
  try {
    const uniqueCategories = await prisma.$queryRaw`
      SELECT DISTINCT type FROM "Location" ORDER BY type ASC
    `;
    
    // Extract the type values from the results
    const categories = uniqueCategories.map(item => item.type);
    
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ...existing routes...

export default router;
