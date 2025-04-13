// Script to verify required environment variables are set

const requiredEnvVars = [
  'DATABASE_URL',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB'
];

function checkEnvironment(): boolean {
  const missing: string[] = [];
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(variable => {
      console.error(`   - ${variable}`);
    });
    
    console.error('\nPlease set these variables in your .env file or environment.');
    return false;
  }
  
  console.log('✅ All required environment variables are set');
  
  // Additional check for DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const url = new URL(dbUrl);
      console.log(`✅ Database connection string has valid format`);
      console.log(`   - Host: ${url.hostname}`);
      console.log(`   - Port: ${url.port}`);
      console.log(`   - Database: ${url.pathname.substring(1)}`);
    } catch (error) {
      console.error('❌ Invalid DATABASE_URL format:', error.message);
      return false;
    }
  }
  
  return true;
}

// Run the check and exit with appropriate code
if (!checkEnvironment()) {
  process.exit(1);
}

console.log('Environment check complete');
