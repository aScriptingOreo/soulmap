import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'url';

// Get domain from environment variables
const domain = process.env.DOMAIN || 'localhost';
const serverPort = parseInt(process.env.SERVER_PORT || '3715');
const serverHost = parseInt(process.env.VITE_API_HOST || '3000');

console.log('=== Admin Panel Configuration ===');
console.log(`Domain: ${domain}`);
console.log(`Server Port: ${serverPort}`);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Add alias for local Font Awesome if needed
      'fontawesome': fileURLToPath(new URL('./src/libs/fontawesome', import.meta.url))
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
        target: `http://${serverHost}:${serverPort}`,
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => { // Add this configure block
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log(`[Proxy Req] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log(`[Proxy Res] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode}`);
          });
          proxy.on('error', (err, req, _res) => {
            console.error('[Proxy Error]', err);
          });
        }
      }
    },
    
    // CORS settings
    cors: true
  }
});
