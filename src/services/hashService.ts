export async function generateContentHash(): Promise<string> {
    try {
        // Get all location and drop files
        const locationFiles = import.meta.glob('../locations/*/*.y?(a)ml', { eager: true });
        const dropFiles = import.meta.glob('../drops/**/*.y?(a)ml', { eager: true });
        
        // Calculate hash based on file contents
        const allFiles = { ...locationFiles, ...dropFiles };
        const contentString = Object.entries(allFiles)
            .map(([path, content]) => `${path}:${JSON.stringify(content)}`)
            .join('|');
        
        // Use a simple hash function
        let hash = 0;
        for (let i = 0; i < contentString.length; i++) {
            const char = contentString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(16);
    } catch (error) {
        console.error('Error generating content hash:', error);
        return Date.now().toString(16); // Fallback to timestamp if hash generation fails
    }
}

export async function generateMapTilesHash(): Promise<string> {
    try {
        const TOTAL_TILES = 196; // Match the constant from GridLoader
        const timestamps = await Promise.all(
            Array.from({ length: TOTAL_TILES }, (_, i) => i).map(async (tileIndex) => {
                try {
                    const response = await fetch(`map/${tileIndex}.png`, { method: 'HEAD' });
                    // Use last-modified and content-length to detect changes
                    const lastModified = response.headers.get('last-modified') || '';
                    const contentLength = response.headers.get('content-length') || '';
                    return `${tileIndex}:${lastModified}:${contentLength}`;
                } catch {
                    return `${tileIndex}:error`;
                }
            })
        );

        // Create a hash from all tile information
        const contentString = timestamps.join('|');
        let hash = 0;
        for (let i = 0; i < contentString.length; i++) {
            const char = contentString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return Math.abs(hash).toString(16);
    } catch (error) {
        console.error('Error generating map tiles hash:', error);
        return Date.now().toString(16);
    }
}

export function getStoredHash(): string {
    return localStorage.getItem('soulmap_content_hash') || '';
}

export function setStoredHash(hash: string): void {
    localStorage.setItem('soulmap_content_hash', hash);
}