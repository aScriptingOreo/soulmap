import { PrismaClient } from '@prisma/client';
import { setTimeout } from 'timers/promises';

const MAX_RETRIES = 20;
const RETRY_DELAY = 3000; // 3 seconds

async function waitForDatabase() {
  const prisma = new PrismaClient();
  let isConnected = false;
  let retries = 0;
  
  console.log('Checking database connection...');
  
  while (!isConnected && retries < MAX_RETRIES) {
    try {
      retries++;
      console.log(`Connection attempt ${retries}/${MAX_RETRIES}...`);
      
      // Simple query to test connection
      await prisma.$queryRaw`SELECT 1 as result`;
      isConnected = true;
      
      console.log('✅ Successfully connected to database');
    } catch (error) {
      console.log(`❌ Connection failed: ${error.message}`);
      console.log(`Waiting ${RETRY_DELAY/1000} seconds before retrying...`);
      await setTimeout(RETRY_DELAY);
    }
  }
  
  if (!isConnected) {
    console.error('Failed to connect to database after maximum retries');
    process.exit(1);
  }
  
  await prisma.$disconnect();
  return true;
}

waitForDatabase().catch(error => {
  console.error('Database connection check failed:', error);
  process.exit(1);
});
