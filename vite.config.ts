// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';
import yaml from '@rollup/plugin-yaml';
import glob from 'vite-plugin-glob';
import fs from 'fs';
import path from 'path';

// Read ports from environment variables, providing defaults
const clientPort = parseInt(process.env.CLIENT_PORT || '5173');

export default defineConfig({
  root: path.resolve(__dirname, 'src'),  // Set root to src directory
  publicDir: '../res', // Set public directory relative to root
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
      // Add this plugin to handle icon caching
      name: 'svg-cache-control',
      configureServer(server) {
        // Add cache headers for SVG files
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.svg')) {
            // Set cache headers for SVG files - 1 week cache
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          }
          next();
        });
      }
    },
    {
      // Development server middleware to provide file metadata through API
      name: 'file-metadata-middleware',
      configureServer(server) {
        server.middlewares.use('/api/file-metadata', (req, res) => {
          const baseDir = process.cwd();
          const locationsDir = path.join(baseDir, 'src/locations');
          const metadata = {};
          
          function scanDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            entries.forEach(entry => {
              const fullPath = path.join(dir, entry.name);
              
              if (entry.isDirectory()) {
                scanDir(fullPath);
              } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
                const stats = fs.statSync(fullPath);
                const relativePath = path.relative(baseDir, fullPath)
                  .replace(/\\/g, '/');
                
                metadata[relativePath] = {
                  path: relativePath,
                  lastModified: stats.mtimeMs
                };
              }
            });
          }
          
          try {
            scanDir(locationsDir);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(metadata));
          } catch (error) {
            console.error('Error generating metadata:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to generate metadata' }));
          }
        });
      }
    },
    {
      // Build plugin to generate static metadata file for production
      name: 'metadata-generator',
      apply: 'build',
      generateBundle() {
        const baseDir = process.cwd();
        const outputDir = path.resolve(baseDir, '../dist');
        const locationsDir = path.join(baseDir, 'locations');
        const metadata = {};
        
        function scanDir(dir) {
          if (!fs.existsSync(dir)) return;
          
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          entries.forEach(entry => {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
              const stats = fs.statSync(fullPath);
              const relativePath = path.relative(baseDir, fullPath)
                .replace(/\\/g, '/');
              
              metadata[relativePath] = {
                path: relativePath,
                lastModified: stats.mtimeMs
              };
            }
          });
        }
        
        try {
          scanDir(locationsDir);
          
          // Ensure output directory exists
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          // Write metadata to JSON file in output directory
          fs.writeFileSync(
            path.join(outputDir, 'file-metadata.json'), 
            JSON.stringify(metadata, null, 2)
          );
          
          console.log('Generated file-metadata.json for production');
        } catch (error) {
          console.error('Error generating metadata file:', error);
        }
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
      allow: ['..']  // Allow access to parent directory
    },
    // Add headers for static assets
    headers: {
      // Set cache-control headers for all static assets
      '*.svg': {
        'Cache-Control': 'public, max-age=604800, immutable' // 1 week
      },
      '*.png': {
        'Cache-Control': 'public, max-age=604800, immutable' // 1 week
      }
    },
    // Allow requests from the specified host when running behind a reverse proxy
    host: '0.0.0.0', // Listen on all network interfaces
    port: clientPort, // Use CLIENT_PORT from env
    allowedHosts: ['dev.soulmap.7thseraph.org']
  },
  assetsInclude: ['**/*.png', '**/*.svg']
});