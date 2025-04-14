/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // Add other environment variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Add global declaration for window extensions
interface Window {
  isDebugEnabled?: boolean;
  handleInternalLink?: (url: URL) => void;
  clearCaches?: () => Promise<void>;
  refreshMapData?: () => Promise<void>;
  isHandlingHistoryNavigation?: boolean;
  complexNavigationInProgress?: boolean;
  clickNavigationInProgress?: boolean;
  lastNavigatedLocation?: string;
  lastNavigatedIndex?: number;
  sidebarInstance?: any;
  generateLocationHash?: (name: string) => string;
  navigateToCoordinates?: (coords: [number, number]) => void;
  markersGlobal?: any[];
}