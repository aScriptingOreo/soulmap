/**
 * Simple analytics module with fallbacks for missing methods
 */

// Feature detection for common analytics APIs
const hasGoogleAnalytics = typeof window !== 'undefined' && 'gtag' in window;
const hasPlausible = typeof window !== 'undefined' && 'plausible' in window;

// Safely call functions with try/catch
const safeCall = (fn: Function, ...args: any[]) => {
  try {
    return fn(...args);
  } catch (error) {
    console.debug('Analytics error:', error);
    return null;
  }
};

// Track page views
function trackPageView(pageName: string) {
  console.debug(`Analytics: Page view - ${pageName}`);
  
  if (hasGoogleAnalytics) {
    safeCall(() => (window as any).gtag('event', 'page_view', {
      page_title: pageName,
      page_location: window.location.href,
      page_path: window.location.pathname
    }));
  }
  
  if (hasPlausible) {
    safeCall(() => (window as any).plausible('pageview', { props: { page: pageName } }));
  }
}

// Track search queries
function trackSearch(query: string, resultCount: number) {
  console.debug(`Analytics: Search - "${query}" (${resultCount} results)`);
  
  if (hasGoogleAnalytics) {
    safeCall(() => (window as any).gtag('event', 'search', {
      search_term: query,
      results_count: resultCount
    }));
  }
  
  if (hasPlausible) {
    safeCall(() => (window as any).plausible('search', { 
      props: { query, resultCount } 
    }));
  }
}

// Track general events
function trackEvent(eventName: string, eventParams: Record<string, any> = {}) {
  console.debug(`Analytics: Event - ${eventName}`, eventParams);
  
  if (hasGoogleAnalytics) {
    safeCall(() => (window as any).gtag('event', eventName, eventParams));
  }
  
  if (hasPlausible) {
    safeCall(() => (window as any).plausible(eventName, { props: eventParams }));
  }
}

// Add the missing trackLocationView function
function trackLocationView(locationName: string, locationType: string, coordinates: [number, number]) {
  trackEvent('location_view', {
    name: locationName,
    type: locationType,
    coordinates: coordinates,
    timestamp: Date.now()
  });
}

// Export a default object with all methods
export default {
  trackPageView,
  trackSearch,
  trackEvent,
  trackLocationView
};