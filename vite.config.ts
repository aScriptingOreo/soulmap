import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import yaml from '@rollup/plugin-yaml';
import glob from 'vite-plugin-glob';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env variables
  const env = loadEnv(mode, process.cwd(), '');
  
  // Get environment variables with fallbacks
  const clientPort = parseInt(env.CLIENT_PORT || '15174');
  const serverPort = parseInt(env.SERVER_PORT || '3000');
  const domain = env.DOMAIN || 'soulmap.avakot.org';
  
  console.log('Environment configuration:');
  console.log(`- Domain: ${domain}`);
  console.log(`- Client Port: ${clientPort}`);
  console.log(`- Server Port: ${serverPort}`);
  console.log(`- API Base URL: ${env.VITE_API_BASE_URL || '/api'}`);
  
  // Determine if we're in a secure context
  const isSecure = domain.startsWith('https://') || 
                  (!domain.startsWith('http://') && !domain.includes('localhost'));
  
  return {
    root: path.resolve(__dirname, 'src'),
    publicDir: '../res',
    build: {
      outDir: '../dist',  // Output to dist directory in project root
      emptyOutDir: true,
      copyPublicDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/index.html')
        }
      }
    },
    plugins: [
      yaml({
        include: ['**/*.yml', '**/*.yaml', 'mapversion.yml']
      }),
      glob(),
      {
        // Development server middleware for debugging - critical for troubleshooting
        name: 'debug-middleware',
        configureServer(server) {
          // Add middleware that logs requests for troubleshooting
          server.middlewares.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
            next();
          });
        }
      },
      {
        // Improved cache control handling
        name: 'svg-cache-control',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Set cache headers for static assets
            if (req.url?.endsWith('.svg') || req.url?.endsWith('.png')) {
              res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Authorization'
      },
      // Simplified proxy configuration using server port from env
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
          // Don't rewrite paths - server expects /api prefix now
          rewrite: (path) => path,
          configure: (proxy) => {
            // Increase timeouts
            proxy.options.timeout = 120000; // 2 minutes
            proxy.options.proxyTimeout = 120000; // 2 minutes
            
            // Add debug logging for proxy requests
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log(`Proxying request: ${req.method} ${req.url} -> ${proxyReq.path}`);
            });
            
            proxy.on('error', (err, req, res) => {
              console.error('Proxy error:', err);
              if (!res.headersSent) {
                res.writeHead(502, {
                  'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                  error: 'Proxy error',
                  message: err.message
                }));
              }
            });
          }
        }
      },
      host: '0.0.0.0',
      port: clientPort,
      strictPort: true,
      hmr: {
        // Fix WebSocket connection issues
        host: domain.replace(/^https?:\/\//, ''), // Strip protocol if present
        clientPort: isSecure ? 443 : clientPort, // Use 443 for secure connections
        protocol: isSecure ? 'wss' : 'ws', // Use secure WebSockets if domain uses HTTPS
        timeout: 120000,
        path: '/ws',
        
        // Add a custom function to handle WebSocket connection options
        webSocketServer: {
          options: {
            // Prevent automatic upgrade to wss when behind HTTPS proxy
            secure: false,
            // Don't verify client cert
            rejectUnauthorized: false
          }
        }
      },
      // Add allowed hosts explicitly using domain from env
      allowedHosts: [
        domain,
        env.API_DOMAIN,
        'localhost',
        '127.0.0.1'
      ],
      watch: {
        usePolling: true,
        interval: 1000
      }
    },
    assetsInclude: ['**/*.png', '**/*.svg']
  };
});