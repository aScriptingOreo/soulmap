import fs from 'fs';
import path from 'path';

interface FileMetadata {
  path: string;
  lastModified: number;
}

/**
 * Service for handling file metadata. This can be used in different ways:
 * 1. At build time to generate a metadata.json file
 * 2. In a development server to get real-time metadata
 * 3. In a desktop app like Electron to access the file system directly
 */
export class FileMetadataService {
  /**
   * Gets the last modified timestamp of a file
   * @param filePath - Path to the file
   * @returns Timestamp in milliseconds
   */
  static getFileLastModified(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.mtimeMs;
    } catch (error) {
      console.error(`Error getting file stats for ${filePath}:`, error);
      return Date.now(); // Fallback to current time
    }
  }

  /**
   * Generates metadata for all location files
   * @param baseDir - Base directory containing location files
   * @returns Object mapping file paths to metadata
   */
  static generateLocationsMetadata(baseDir: string): Record<string, FileMetadata> {
    const locationsDir = path.join(baseDir, 'src/locations');
    const metadata: Record<string, FileMetadata> = {};

    try {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        entries.forEach(entry => {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
            const relativePath = path.relative(baseDir, fullPath)
              .replace(/\\/g, '/'); // Normalize path separators
            
            metadata[relativePath] = {
              path: relativePath,
              lastModified: this.getFileLastModified(fullPath)
            };
          }
        });
      };

      scanDir(locationsDir);
    } catch (error) {
      console.error('Error generating locations metadata:', error);
    }

    return metadata;
  }

  /**
   * Saves metadata to a JSON file
   * @param metadata - The metadata to save
   * @param outputPath - Path to save the metadata file
   */
  static saveMetadata(metadata: Record<string, FileMetadata>, outputPath: string): void {
    try {
      fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2));
      console.log(`Metadata saved to ${outputPath}`);
    } catch (error) {
      console.error('Error saving metadata:', error);
    }
  }
}
