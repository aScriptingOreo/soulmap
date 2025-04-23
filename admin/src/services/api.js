/**
 * API service for the admin panel
 */

import { discoverFontAwesomeIcons } from '../utils/fontAwesomeIcons';

// Define the API base URLs correctly
const API_BASE_URL = '/api'; // For public endpoints if needed
const ADMIN_API_BASE_URL = '/api/admin'; // For admin endpoints

// For now, we're using a simple API token approach
// In a real app, this would be handled via proper authentication
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_API_TOKEN || 'dev-token';

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  // The 'endpoint' parameter should already be the full path, e.g., /api/admin/locations
  const url = endpoint; // Use the endpoint directly, DO NOT prepend API_BASE_URL here

  const headers = {
    'Content-Type': 'application/json',
    // Use Authorization header standard
    'Authorization': `Bearer ${ADMIN_TOKEN}`, 
    ...options.headers
  };
  
  console.log(`[apiRequest] Fetching: ${options.method || 'GET'} ${url}`); // Log the final URL

  try { // Add try block for better error handling
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})); // Try to parse error JSON
      console.error(`API Error Response (${response.status} for ${url}):`, errorData);
      // Use error message from response if available, otherwise status
      throw new Error(errorData.error || `API error: ${response.status}`); 
    }
    
    // Handle 204 No Content for DELETE
    if (response.status === 204) {
      return null; 
    }

    // Check if response is JSON before parsing
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      return await response.json();
    } else {
      // Handle non-JSON responses if necessary, or return null/empty object
      console.warn(`API response for ${url} was not JSON.`);
      return await response.text(); // Or return null;
    }
  } catch (error) {
    console.error(`API Request Failed for ${url}:`, error);
    // Re-throw a consistent error format
    throw new Error(error.message.startsWith('API error:') ? error.message : `API error: ${error.message || 'Network Error'}`);
  }
}

/**
 * Get all requests (Assuming this uses /api/admin/requests)
 */
export async function getRequests() {
  return apiRequest(`${ADMIN_API_BASE_URL}/requests`); // Pass full path
}

/**
 * Update request status (Assuming this uses /api/admin/requests/:id/status)
 */
export async function updateRequestStatus(id, status, reason = '') {
  return apiRequest(`${ADMIN_API_BASE_URL}/requests/${id}/status`, { // Pass full path
    method: 'POST',
    body: JSON.stringify({ status, reason })
  });
}

/**
 * Get all locations (Uses public /api/locations)
 */
export async function getLocations() {
  return apiRequest(`${API_BASE_URL}/locations`); // Pass full path
}

/**
 * Get a single location by ID (Uses admin /api/admin/locations/:id)
 * @param {string} id - Location ID
 * @returns {Promise<Object>} Location data
 */
export function getLocation(id) {
  return apiRequest(`${ADMIN_API_BASE_URL}/locations/${id}`); // Pass full path
}

/**
 * Get all unique location categories (Uses admin /api/admin/categories)
 */
export async function getCategories() {
  return apiRequest(`${ADMIN_API_BASE_URL}/categories`); // Pass full path
}

/**
 * Create a new location (Uses dedicated endpoint for creation)
 */
export async function createLocation(locationData) {
  const url = `${ADMIN_API_BASE_URL}/locations/new`; // Use new dedicated endpoint
  console.log(`Attempting to create location via POST ${url}`);
  return apiRequest(url, { 
    method: 'POST',
    body: JSON.stringify(locationData)
  });
}

/**
 * Update an existing location (Uses admin /api/admin/locations/:id)
 */
export async function updateLocation(id, locationData) {
  const url = `${ADMIN_API_BASE_URL}/locations/${id}`; // Correct path: /api/admin/locations/:id
  console.log(`Attempting to update location via PUT ${url}`);
   // Pass the full 'url' directly to apiRequest
  return apiRequest(url, {
    method: 'PUT',
    body: JSON.stringify(locationData)
  });
}

/**
 * Delete a location (Uses admin /api/admin/locations/:id)
 */
export async function deleteLocation(id) {
  const url = `${ADMIN_API_BASE_URL}/locations/${id}`; // Correct path: /api/admin/locations/:id
  console.log(`Attempting to delete location via DELETE ${url}`);
   // Pass the full 'url' directly to apiRequest
  return apiRequest(url, {
    method: 'DELETE'
  });
}

/**
 * Extract unique icons from locations and include Font Awesome icons
 */
export function extractIconsFromLocations() {
  return getLocations()
    .then(locations => {
      const iconSet = new Set();
      
      // Get Font Awesome icons
      discoverFontAwesomeIcons().forEach(icon => iconSet.add(icon));
      
      // Add icons from actual locations
      locations.forEach(location => {
        if (location.icon) {
          iconSet.add(location.icon);
        }
      });
      
      return Array.from(iconSet).sort();
    });
}

export default {
  getRequests,
  updateRequestStatus,
  getLocations,
  getLocation,
  getCategories,
  createLocation,
  updateLocation,
  deleteLocation,
  extractIconsFromLocations
};
