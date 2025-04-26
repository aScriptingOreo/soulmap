import { PrismaClient } from '@prisma/client';

// Create a singleton instance of PrismaClient with more robust error handling
let prismaInstance = null;

try {
  prismaInstance = new PrismaClient({
    // Add error logging but don't fail on connection issues
    log: ['error'],
    errorFormat: 'pretty',
  });
  console.log('Prisma client initialized successfully');
} catch (error) {
  console.error('Failed to initialize Prisma client:', error.message);
  // Create a mock instance with basic functionality
  prismaInstance = {
    // Add mock implementations for commonly used methods
    $connect: () => Promise.resolve(),
    $disconnect: () => Promise.resolve(),
    // Add warning for any access to avoid silent failures
    location: new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined; // For promise compatibility
        return (...args) => {
          console.warn(`Database operation '${String(prop)}' called but Prisma client is not initialized`);
          // Return empty results based on common Prisma methods
          if (['findMany', 'findFirst', 'findUnique'].includes(String(prop))) {
            return Promise.resolve([]);
          }
          return Promise.resolve(null);
        };
      }
    }),
    heatmapDatapoint: new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined; // For promise compatibility
        return (...args) => {
          console.warn(`Database operation '${String(prop)}' called but Prisma client is not initialized`);
          // Return empty results based on common Prisma methods
          if (['findMany', 'findFirst', 'findUnique'].includes(String(prop))) {
            return Promise.resolve([]);
          }
          return Promise.resolve(null);
        };
      }
    }),
    heatmapType: new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined; // For promise compatibility
        return (...args) => {
          console.warn(`Database operation '${String(prop)}' called but Prisma client is not initialized`);
          // Return empty results based on common Prisma methods
          if (['findMany', 'findFirst', 'findUnique'].includes(String(prop))) {
            return Promise.resolve([]);
          }
          return Promise.resolve(null);
        };
      }
    })
  };
}

// Export the singleton instance
export const prisma = prismaInstance;

// Handle graceful shutdown
process.on('beforeExit', async () => {
  if (prismaInstance && typeof prismaInstance.$disconnect === 'function') {
    await prismaInstance.$disconnect();
  }
});
