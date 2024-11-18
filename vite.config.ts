// vite.config.ts
import { defineConfig } from 'vite';
import yaml from '@rollup/plugin-yaml';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'), // Set src/ as the root
  publicDir: path.resolve(__dirname, 'res'), // Serve static assets from res/
  build: {
    outDir: '../dist', // Output directory
    emptyOutDir: true,
  },
  plugins: [
    yaml()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.js', '.ts', '.json', '.yaml', '.yml']
  },
  server: {
    fs: {
      allow: ['..'] // Allow accessing files from the project root if needed
    }
  }
});