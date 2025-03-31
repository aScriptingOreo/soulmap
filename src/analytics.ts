/**
 * Client-side analytics for user tracking
 */

const SESSION_ID_KEY = 'soulmap_session_id';
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

class Analytics {
  private sessionId: string;
  private heartbeatInterval: number | null = null;
  private apiUrl: string;
  private enabled: boolean = true;
  private activeUsers: number = 0;
  private failedAttempts: number = 0;
  private gaEnabled: boolean = true; // Google Analytics flag

  constructor(apiBaseUrl?: string) {
    // Use provided URL, or current origin (for production), or fallback to localhost:3000
    this.apiUrl = apiBaseUrl || 
                (window.location.hostname !== 'localhost' ? 
                `${window.location.origin}/api` : 
                'https://soulmap.avakot.org/api');
    
    console.log(`Analytics initialized with API URL: ${this.apiUrl}`);
    
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
    
    if (this.enabled) {
      // Start heartbeat
      this.startHeartbeat();
      
      // Send initial heartbeat
      this.sendHeartbeat();
      
      // Handle page visibility changes
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.sendHeartbeat();
          this.startHeartbeat();
          // Track page view when tab becomes visible again
          this.trackEvent('visibility_change', 'visible');
        } else {
          this.stopHeartbeat();
          // Track when user leaves the tab
          this.trackEvent('visibility_change', 'hidden');
        }
      });
      
      // Handle before unload
      window.addEventListener('beforeunload', () => {
        this.stopHeartbeat();
        // Track page exit
        this.trackEvent('exit_page', 'unload');
      });
    }
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
    return this.activeUsers;
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

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = window.setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Pause analytics temporarily
   */
  private pauseAnalytics(): void {
    this.stopHeartbeat();
    setTimeout(() => {
      this.startHeartbeat();
    }, HEARTBEAT_INTERVAL * 2); // Pause for double the interval
  }

  /**
   * Send heartbeat to server
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.enabled) return;
    
    try {
      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      // Log the actual URL being used for debugging
      const endpoint = `${this.apiUrl}/heartbeat`;
      console.log(`Sending heartbeat to: ${endpoint}`);
      
      // Use the public heartbeat endpoint
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Handle rate limiting
      if (response.status === 429) {
        console.log('Analytics rate limited. Will retry later.');
        // Pause heartbeats temporarily
        this.pauseAnalytics();
        return;
      }
      
      // Handle 404 errors specifically - might be in development mode
      if (response.status === 404) {
        console.warn('Analytics endpoint not found (404). Disabling analytics.');
        this.enabled = false;
        this.stopHeartbeat();
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      this.activeUsers = data.activeUsers || 0;
      
      // Update session ID if server generated a new one
      if (data.sessionId && data.sessionId !== this.sessionId) {
        this.sessionId = data.sessionId;
        localStorage.setItem(SESSION_ID_KEY, this.sessionId);
      }
      
      // Reset failed attempts counter on successful response
      this.failedAttempts = 0;
      
      // Dispatch event for UI updates
      window.dispatchEvent(new CustomEvent('analyticsUpdate', { 
        detail: { activeUsers: this.activeUsers }
      }));
    } catch (error) {
      // Gracefully handle network errors
      console.warn('Analytics heartbeat failed:', 
        error instanceof Error ? error.message : 'Unknown error');
        
      // If we repeatedly fail, consider disabling temporarily
      this.failedAttempts += 1;
      if (this.failedAttempts > 5) {
        console.log('Multiple analytics failures. Pausing analytics temporarily.');
        this.pauseAnalytics();
      }
    }
  }
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