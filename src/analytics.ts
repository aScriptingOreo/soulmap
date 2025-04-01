/**
 * Client-side analytics for user tracking
 */

const SESSION_ID_KEY = 'soulmap_session_id';
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

class Analytics {
  private sessionId: string;
  private heartbeatInterval: number | null = null;
  private apiUrl: string;
  private enabled: boolean = false; // Disable by default
  private activeUsers: number = 0;
  private failedAttempts: number = 0;
  private gaEnabled: boolean = true; // Google Analytics flag

  constructor(apiBaseUrl?: string) {
    // Set API URL to empty - we won't be using it
    this.apiUrl = '';
    
    console.log('Analytics initialized (API endpoints disabled)');
    
    this.sessionId = this.getOrCreateSessionId();
    
    // Check if analytics should be disabled
    const urlParams = new URLSearchParams(window.location.search);
    this.enabled = urlParams.get('noAnalytics') !== 'true';
    
    // Check for Do Not Track setting
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') {
      this.gaEnabled = false;
      // Disable Google Analytics if Do Not Track is enabled
      if (window.gtag) {
        window.gtag('consent', 'update', {
          'analytics_storage': 'denied'
        });
      }
    }
    
    // We're not starting heartbeat anymore
    // No need to add event listeners for visibility changes or page unload
  }
  
  /**
   * Track an event in Google Analytics
   */
  public trackEvent(eventName: string, eventParams?: any): void {
    // Only send to GA if enabled
    if (this.gaEnabled && window.gtag) {
      window.gtag('event', eventName, eventParams);
    }
  }
  
  /**
   * Track location view
   */
  public trackLocationView(locationName: string, locationType: string): void {
    this.trackEvent('location_view', {
      location_name: locationName,
      location_type: locationType
    });
  }
  
  /**
   * Track search action
   */
  public trackSearch(searchQuery: string, resultsCount: number): void {
    this.trackEvent('search', {
      search_term: searchQuery,
      results_count: resultsCount
    });
  }

  /**
   * Get current active users count
   */
  getActiveUsers(): number {
    return 0; // Since we're not tracking users via API
  }
  
  /**
   * Get or create a session ID
   */
  private getOrCreateSessionId(): string {
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = this.generateSessionId();
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  }

  /**
   * Generate a new session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Removed all heartbeat-related methods
}

// Create and export singleton instance
const analytics = new Analytics();
export default analytics;

// Add type definitions to global Window interface
declare global {
  interface Window {
    gtag: (command: string, action: string, params?: any) => void;
    dataLayer: any[];
    doNotTrack: string;
  }
}