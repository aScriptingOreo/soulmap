import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Initialize PrismaClient
const prisma = new PrismaClient();

async function checkIfTablesExist(): Promise<boolean> {
  try {
    console.log('Checking if database tables exist...');
    // Try to query a table that should exist if the schema is set up
    await prisma.$queryRaw`SELECT 1 FROM "Location" LIMIT 1`;
    console.log('Database tables exist');
    return true;
  } catch (error) {
    // If we get a specific error about relation not existing, tables aren't set up
    if (error.message && error.message.includes('relation') && error.message.includes('does not exist')) {
      console.log('Database tables do not exist yet, migration needed');
      return false;
    }
    // For other errors, let them propagate
    console.error('Unexpected error checking tables:', error.message);
    throw error;
  }
}

async function runPrismaMigrate(): Promise<boolean> {
  try {
    console.log('Running Prisma migrations...');
    
    // Check if the migrations directory exists
    const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');
    const hasMigrations = fs.existsSync(migrationsDir) && 
                         fs.readdirSync(migrationsDir).length > 0;
    
    if (hasMigrations) {
      // If we have existing migrations, deploy them
      console.log('Found existing migrations, deploying...');
      const { stdout, stderr } = await execAsync('cd prisma && npx prisma migrate deploy');
      
      console.log('Migration output:', stdout);
      
      if (stderr) {
        console.warn('Migration warnings:', stderr);
      }
    } else {
      // If no migrations exist, create an initial one
      console.log('No migrations found, creating initial migration...');
      const { stdout, stderr } = await execAsync('cd prisma && npx prisma migrate dev --name initial_schema');
      
      console.log('Initial migration output:', stdout);
      
      if (stderr) {
        console.warn('Initial migration warnings:', stderr);
      }
    }
    
    // After migrations, set up the notification trigger
    console.log('Setting up database notification triggers...');
    try {
      const triggerPath = path.resolve(__dirname, '../../prisma/migrations/notification_trigger.sql');
      if (fs.existsSync(triggerPath)) {
        const triggerSql = fs.readFileSync(triggerPath, 'utf8');
        
        // Split into individual statements - making sure to respect the $$ delimiters
        const statements = [];
        let currentStatement = '';
        let inDollarQuote = false;
        
        for (const line of triggerSql.split('\n')) {
          currentStatement += line + '\n';
          
          if (line.includes('$$')) {
            // Toggle the dollar quote state - this handles both opening and closing dollar quotes
            inDollarQuote = !inDollarQuote;
          }
          
          // If we're not inside a dollar quote and this line contains a semicolon, 
          // it's the end of a statement
          if (!inDollarQuote && line.trim().endsWith(';')) {
            statements.push(currentStatement.trim());
            currentStatement = '';
          }
        }
        
        // Handle any remaining statements
        if (currentStatement.trim()) {
          statements.push(currentStatement.trim());
        }
        
        // Execute each statement separately
        for (const statement of statements) {
          console.log(`Executing SQL statement: ${statement.substring(0, 100)}...`);
          await prisma.$executeRawUnsafe(statement);
        }
        
        console.log('Database notification triggers installed successfully');
      } else {
        console.warn('Notification trigger SQL file not found at:', triggerPath);
      }
    } catch (triggerError) {
      console.error('Error setting up notification triggers:', triggerError);
      // Don't fail the migration if triggers fail - they're optional
    }
    
    console.log('Migrations completed successfully.');
    return true;
  } catch (error) {
    console.error('Failed to run migrations:', error);
    throw error;
  }
}

async function seedDatabase(): Promise<void> {
  try {
    console.log('Checking if database needs seeding...');
    
    // Check if there are any locations in the database
    const locationCount = await prisma.location.count();
    console.log(`Current location count: ${locationCount}`);
    
    if (locationCount > 0) {
      console.log('Database already has data, no seeding needed');
      return;
    }
    
    console.log('Database is empty, running seeder...');
    const { stdout, stderr } = await execAsync('bun run server/utils/seed-database.ts');
    
    if (stdout) {
      console.log('Seeder output:', stdout);
    }
    
    if (stderr) {
      console.warn('Seeder warnings:', stderr);
    }
    
    console.log('Database seeding completed');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

async function initDatabase(): Promise<void> {
  try {
    console.log('Checking database status...');
    
    // First check if tables already exist
    const tablesExist = await checkIfTablesExist();
    
    if (!tablesExist) {
      console.log('Database tables not found. Running migrations...');
      await runPrismaMigrate();
    }
    
    // Seed the database if it's empty (regardless of whether we just ran migrations)
    await seedDatabase();
    
    console.log('Database initialization completed successfully.');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the initialization
initDatabase()
  .then(() => {
    console.log('Database ready.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal database initialization error:', error);
    process.exit(1);
  });
