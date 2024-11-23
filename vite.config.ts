// vite.config.ts
import { defineConfig } from 'vite';
import yaml from '@rollup/plugin-yaml';
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
    })
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