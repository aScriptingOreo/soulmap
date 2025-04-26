import { setTimeout } from 'timers/promises';

const MAX_RETRIES = 20;
const RETRY_DELAY = 3000; // 3 seconds
const API_PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}/api/health`;

async function waitForApi() {
  let isReady = false;
  let retries = 0;
  
  console.log('Checking API health...');
  console.log(`Using API URL: ${API_URL}`);
  
  while (!isReady && retries < MAX_RETRIES) {
    try {
      retries++;
      console.log(`Health check attempt ${retries}/${MAX_RETRIES}...`);
      
      const response = await fetch(API_URL);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok') {
          isReady = true;
          console.log('✅ API is healthy and ready');
        } else {
          throw new Error('API returned non-ok status');
        }
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ API not ready: ${error.message}`);
      console.log(`Waiting ${RETRY_DELAY/1000} seconds before retrying...`);
      await setTimeout(RETRY_DELAY);
    }
  }
  
  if (!isReady) {
    console.error('Failed to connect to API after maximum retries');
    process.exit(1);
  }
  
  return true;
}

waitForApi().catch(error => {
  console.error('API health check failed:', error);
  process.exit(1);
});
