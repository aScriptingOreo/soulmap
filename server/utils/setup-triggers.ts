import { readFileSync } from 'fs';
import { resolve } from 'path';
import db from '../db';

async function setupTriggers() {
  try {
    console.log('Setting up database triggers for real-time notifications...');
    
    // Read the SQL file
    const sqlPath = resolve(__dirname, 'triggers.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    await db.query(sql);
    
    console.log('Database triggers successfully set up');
  } catch (error) {
    console.error('Error setting up database triggers:', error);
    process.exit(1);
  }
}

// Run the setup
setupTriggers()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Uncaught error in trigger setup:', error);
    process.exit(1);
  });
