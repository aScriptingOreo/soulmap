import { defineConfig } from 'vite';
import { resolve } from 'path';
import yaml from '@rollup/plugin-yaml';
import glob from 'vite-plugin-glob';
import path from 'path';
import fs from 'fs';

// Load environment variables directly to ensure they're available
const envFile = fs.readFileSync(path.resolve(__dirname, '.env'), 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  // Skip comments and empty lines
  if (line.trim().startsWith('#') || !line.trim()) return;
  
  const [key, value] = line.split('=');
  if (key && value) {
    env[key.trim()] = value.trim().replace(/^["'](.*)["']$/, '$1');
  }
});

// Get environment variables with fallbacks
const clientPort = parseInt(process.env.CLIENT_PORT || env.CLIENT_PORT || '5173');
const serverPort = parseInt(process.env.SERVER_PORT || env.SERVER_PORT || '3715');
const domain = process.env.DOMAIN || env.DOMAIN || 'soulmap.avakot.org';

console.log('=== Environment Configuration ===');
console.log(`Domain: ${domain}`);
console.log(`Client Port: ${clientPort}`);
console.log(`Server Port: ${serverPort}`);
console.log(`DATABASE_URL: ${!!process.env.DATABASE_URL || !!env.DATABASE_URL}`);
console.log(`ENV LOADING METHOD: Manual parser`);

export default defineConfig({
  // Set base to root path
  base: '/',
  
  // Keep the root in src
  root: path.resolve(__dirname, 'src'),
  publicDir: '../res',
  
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    copyPublicDir: true,
  },
  
  plugins: [
    yaml({
      include: ['**/*.yml', '**/*.yaml', 'mapversion.yml']
    }),
    glob(),
    {
      name: 'spa-fallback',
      configureServer(server) {
        // Log requests for debugging
        server.middlewares.use((req, res, next) => {
          console.log(`[Request] ${req.method} ${req.url}`);
          next();
        });
        
        // SPA fallback for HTML5 routing
        server.middlewares.use((req, res, next) => {
          if (req.url && 
              !req.url.includes('.') && 
              !req.url.startsWith('/api') &&
              !req.url.startsWith('/@')) {
            console.log(`[SPA] Redirecting ${req.url} to /index.html`);
            req.url = '/index.html';
          }
          next();
        });
      }
    }
  ],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  
  server: {
    fs: {
      allow: ['..']
    },
    
    // Basic server config
    host: '0.0.0.0',
    port: clientPort,
    strictPort: true,
    
    // Critical: Properly proxy API requests to the internal server
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        configure: (proxy) => {
          // Add debugging
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(`[API Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
          });
          
          proxy.on('error', (err, req, res) => {
            console.error('[API Proxy Error]', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
            }
          });
        }
      }
    },
    
    // Disable HMR to avoid client errors
    hmr: false,
    
    // Explicitly allow the domain
    allowedHosts: [domain, 'localhost', '127.0.0.1', 'soulmap.avakot.org'],
    
    // Accept any host to avoid CORS issues
    cors: true,
    origin: '*',
    
    // Just to be extra sure
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  }
});