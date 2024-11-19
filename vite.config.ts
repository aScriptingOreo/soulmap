// vite.config.ts
import { defineConfig } from 'vite';
import yaml from '@rollup/plugin-yaml';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  publicDir: path.resolve(__dirname, 'res'),
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [
    yaml({
      include: ['src/**/*.yml', 'src/**/*.yaml', 'src/mapversion.yml'] // Explicitly include mapversion.yml
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.js', '.ts', '.json', '.yaml', '.yml']
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});