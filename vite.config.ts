// vite.config.ts
import { defineConfig } from 'vite';
import yaml from '@rollup/plugin-yaml';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),  // Set root to src directory
  publicDir: path.resolve(__dirname, 'res'), // Keep res as public dir
  build: {
    outDir: '../dist',  // Output to parent dist directory
    emptyOutDir: true,
  },
  plugins: [
    yaml({
      include: ['**/*.yml', '**/*.yaml', 'mapversion.yml']
    }),
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
      '@': path.resolve(__dirname, './src'),
      'res': path.resolve(__dirname, './res')
    },
    extensions: ['.js', '.ts', '.json', '.yaml', '.yml', '.png']
  },
  server: {
    fs: {
      allow: ['..']  // Allow access to parent directory
    }
  },
  assetsInclude: ['**/*.png']
});