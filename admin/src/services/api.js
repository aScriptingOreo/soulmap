/**
 * API service for the admin panel
 */

import { discoverFontAwesomeIcons } from '../utils/fontAwesomeIcons';

// Use the backend API regardless of environment
// Docker networking will handle routing through the proxy
const API_BASE = '/api';

// For now, we're using a simple API token approach
// In a real app, this would be handled via proper authentication
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_API_TOKEN || 'dev-token';

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Token': ADMIN_TOKEN,
    ...options.headers
  };
  
  const response = await fetch(url, {
    ...options,
    headers
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get all requests
 */
export async function getRequests() {
  return apiRequest('/admin/requests');
}

/**
 * Update request status
 */
export async function updateRequestStatus(id, status, reason = '') {
  return apiRequest(`/admin/requests/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, reason })
  });
}

/**
 * Get all locations
 */
export async function getLocations() {
  return apiRequest('/locations');
}

/**
 * Get single location by ID
 */
/**export async function getLocation(id) {
  return apiRequest(`/locations/${id}`);
}

/**
 * Get a single location by ID
 * @param {string} id - Location ID
 * @returns {Promise<Object>} Location data
 */
export function getLocation(id) {
  try {
    return apiRequest(`/admin/locations/${id}`);
  } catch (error) {
    console.error(`Failed to fetch location ${id}:`, error);
    throw error;
  }
}

/**
 * Get all unique location categories
 */
export async function getCategories() {
  return apiRequest('/admin/categories');
}

/**
 * Create a new location
 */
export async function createLocation(locationData) {
  return apiRequest('/admin/locations', {
    method: 'POST',
    body: JSON.stringify(locationData)
  });
}

/**
 * Update an existing location
 */
export async function updateLocation(id, locationData) {
  return apiRequest(`/admin/locations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(locationData)
  });
}

/**
 * Delete a location
 */
export async function deleteLocation(id) {
  return apiRequest(`/admin/locations/${id}`, {
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
