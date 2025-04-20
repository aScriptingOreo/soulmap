import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'url';

// Get domain from environment variables
const domain = process.env.DOMAIN || 'localhost';
const serverPort = parseInt(process.env.SERVER_PORT || '3715');

console.log('=== Admin Panel Configuration ===');
console.log(`Domain: ${domain}`);
console.log(`Server Port: ${serverPort}`);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  
  // Set base URL back to /admin/ since Traefik is serving the app at this path
  base: '/admin/',
  
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    
    // Explicitly allow the domain along with 'localhost' and other default domains
    allowedHosts: [domain, 'localhost', '127.0.0.1', 'soulmap.avakot.org'],
    
    // API proxy to main server
    proxy: {
      '/api': {
        target: `http://soulmap:${serverPort}`,
        changeOrigin: true,
        secure: false
      }
    },
    
    // CORS settings
    cors: true
  }
});
