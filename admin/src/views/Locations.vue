<template>
  <div class="locations-container">
    <div class="header">
      <h1>Locations</h1>
      <button @click="openAddModal" class="add-btn">+ Add Location</button>
    </div>
    
    <div class="filters">
      <input 
        v-model="search" 
        type="text" 
        placeholder="Search locations..."
        class="search-input"
      >
      
      <select v-model="categoryFilter" class="category-filter">
        <option value="">All Categories</option>
        <option v-for="(label, value) in categories" :key="value" :value="value">{{ label }}</option>
      </select>
      
      <div class="sort-options">
        <label>Sort by:</label>
        <select v-model="sortOption" class="sort-select">
          <option value="name_asc">Name (A-Z)</option>
          <option value="name_desc">Name (Z-A)</option>
          <option value="category_asc">Category (A-Z)</option>
          <option value="category_desc">Category (Z-A)</option>
          <option value="recent">Recently Updated</option>
        </select>
      </div>
    </div>
    
    <div v-if="loading" class="loading">
      <p>Loading locations...</p>
    </div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="fetchLocations" class="retry-btn">Retry</button>
    </div>
    
    <div v-else-if="filteredLocations.length === 0" class="no-results">
      <p>No locations found.</p>
    </div>
    
    <div v-else class="locations-table">
      <table>
        <thead>
          <tr>
            <th @click="updateSort('name')">
              Name
              <span v-if="sortOption === 'name_asc'" class="sort-indicator">▲</span>
              <span v-if="sortOption === 'name_desc'" class="sort-indicator">▼</span>
            </th>
            <th @click="updateSort('category')">
              Category
              <span v-if="sortOption === 'category_asc'" class="sort-indicator">▲</span>
              <span v-if="sortOption === 'category_desc'" class="sort-indicator">▼</span>
            </th>
            <th>Coordinates</th>
            <th>Tags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="location in filteredLocations" :key="location.id">
            <td class="name-cell">{{ location.name }}</td>
            <td class="category-cell">
              <span :class="'category-badge ' + location.type">
                {{ getCategoryLabel(location.type) }}
              </span>
            </td>
            <td class="coords-cell">
              <div v-if="location.coordinates && getFormattedCoordinates(location.coordinates).length > 3" class="coord-summary">
                {{ getFormattedCoordinates(location.coordinates)[0] }}, 
                {{ getFormattedCoordinates(location.coordinates)[1] }}, 
                {{ getFormattedCoordinates(location.coordinates)[2] }}
                <span class="more-coords">+{{ getFormattedCoordinates(location.coordinates).length - 3 }}</span>
              </div>
              <div v-else>
                <div v-for="(coord, index) in getFormattedCoordinates(location.coordinates)" :key="index" class="coord">
                  {{ coord }}
                </div>
              </div>
            </td>
            <td class="tags-cell">
              <div class="tags-list">
                <span v-for="(tag, index) in extractTagsFromDescription(location.description)" :key="index" class="tag">
                  {{ tag }}
                </span>
              </div>
            </td>
            <td class="actions-cell">
              <button @click="openEditModal(location)" class="edit-btn" :title="canEdit ? 'Edit location' : 'View location details'">
                {{ canEdit ? 'Edit' : 'View' }}
              </button>
              <button 
                v-if="canDelete" 
                @click="openDeleteModal(location)" 
                class="delete-btn"
                title="Delete location"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Modal for editing/adding locations -->
    <LocationEditModal 
      v-if="showModal"
      :location="currentLocation"
      :isNew="isNewLocation"
      @save="saveLocation"
      @close="closeModal"
      @delete="deleteLocation"
    />
    
    <!-- Success Notification -->
    <div v-if="notification.show" class="notification" :class="notification.type">
      {{ notification.message }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import LocationEditModal from '../components/LocationEditModal.vue';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import webhook from '../services/webhook';

// State
const locationsList = ref([]);  // Changed from 'locations' to 'locationsList' to avoid duplicate declaration
const categories = ref({});
const loading = ref(true);
const error = ref(null);
const search = ref('');
const categoryFilter = ref('');
const sortOption = ref('name_asc');
const showModal = ref(false);
const currentLocation = ref({});
const isNewLocation = ref(false);
const notification = ref({
  show: false,
  message: '',
  type: 'success'
});

// Get auth store for role checking
const authStore = useAuthStore();

// Role-based permissions
const canEdit = computed(() => {
  // Admin or Manager role IDs
  const ADMIN_ROLE_ID = '1309700533749289012';
  const MANAGER_ROLE_ID = '1363588579506262056';
  
  return authStore.user?.roles?.some(role => 
    [ADMIN_ROLE_ID, MANAGER_ROLE_ID].includes(role)
  );
});

const canDelete = computed(() => {
  // Only Admin can delete
  const ADMIN_ROLE_ID = '1309700533749289012';
  return authStore.user?.roles?.includes(ADMIN_ROLE_ID);
});

// Extract hashtags from description
function extractTagsFromDescription(description) {
  if (!description) return [];
  
  const tagRegex = /#(\w+)/g;
  const matches = description.match(tagRegex);
  
  if (matches) {
    return matches.map(tag => tag.substring(1)); // Remove # prefix
  }
  
  return [];
}

// Format coordinates for display consistently in [X, Y] format
function getFormattedCoordinates(coordinates) {
  if (!coordinates) return [];
  
  try {
    // Simple single coordinate as [x, y]
    if (Array.isArray(coordinates) && coordinates.length === 2 && 
        typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      return [`[${coordinates[0]}, ${coordinates[1]}]`];
    }
    
    // Complex coordinates as [[x,y], [x,y], ...]
    if (Array.isArray(coordinates) && Array.isArray(coordinates[0]) && coordinates[0].length === 2) {
      return coordinates.map(pair => `[${pair[0]}, ${pair[1]}]`);
    }
    
    // If it's already an array of strings in [X, Y] format
    if (Array.isArray(coordinates) && coordinates.length > 0 && 
        typeof coordinates[0] === 'string' && /^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/.test(coordinates[0])) {
      return coordinates;
    }
    
    // If it's a JSON string, try to parse it
    if (typeof coordinates === 'string') {
      const parsed = JSON.parse(coordinates);
      return getFormattedCoordinates(parsed);
    }
    
    console.warn("Unknown coordinate format:", coordinates);
    return [];
  } catch (error) {
    console.error("Error formatting coordinates:", error);
    return [];
  }
}

// Get category label from type (handle case insensitively)
function getCategoryLabel(type) {
  if (!type) return 'Unknown';
  
  // Convert type to lowercase for case-insensitive matching
  const typeLower = type.toLowerCase();
  
  // Check if the lowercase type exists in our categories
  if (categories.value[typeLower]) {
    return categories.value[typeLower];
  }
  
  // If not found, try to capitalize the first letter for display
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Fetch categories from the database
async function fetchCategories() {
  try {
    const allCategories = await api.getCategories();
    const categoriesMap = {};
    
    // Extract unique categories and create options map
    allCategories.forEach(cat => {
      const type = cat.toLowerCase();
      // Format the display name (capitalize first letter of each word)
      const displayName = type
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      categoriesMap[type] = displayName;
    });
    
    // Add "other" as a fallback category if not already present
    if (!categoriesMap['other']) {
      categoriesMap['other'] = 'Other';
    }
    
    categories.value = categoriesMap;
  } catch (error) {
    console.error('Failed to load categories:', error);
    // Fallback to default categories
    categories.value = {
      'town': 'Town',
      'poi': 'Point of Interest',
      'dungeon': 'Dungeon',
      'resource': 'Resource',
      'social': 'Social',
      'boss': 'Boss',
      'quest': 'Quest',
      'vendor': 'Vendor',
      'other': 'Other'
    };
  }
}

// Filter and sort locations based on search, category, and sort option
const filteredLocations = computed(() => {
  let result = [...locationsList.value];
  
  // Filter by search term
  if (search.value) {
    const searchLower = search.value.toLowerCase();
    result = result.filter(loc => 
      loc.name?.toLowerCase().includes(searchLower) || 
      loc.description?.toLowerCase().includes(searchLower) ||
      extractTagsFromDescription(loc.description).some(tag => 
        tag.toLowerCase().includes(searchLower)
      ) ||
      getCategoryLabel(loc.type).toLowerCase().includes(searchLower)
    );
  }
  
  // Filter by category (mapping from type)
  if (categoryFilter.value) {
    result = result.filter(loc => 
      loc.type?.toLowerCase() === categoryFilter.value.toLowerCase()
    );
  }
  
  // Sort the results
  result.sort((a, b) => {
    switch (sortOption.value) {
      case 'name_asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name_desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'category_asc':
        return getCategoryLabel(a.type).localeCompare(getCategoryLabel(b.type));
      case 'category_desc':
        return getCategoryLabel(b.type).localeCompare(getCategoryLabel(a.type));
      case 'recent':
        return new Date(b.updatedAt || b.lastModified || 0) - new Date(a.updatedAt || a.lastModified || 0);
      default:
        return 0;
    }
  });
  
  return result;
});

// Update sort selection
function updateSort(field) {
  if (field === 'name') {
    sortOption.value = sortOption.value === 'name_asc' ? 'name_desc' : 'name_asc';
  } else if (field === 'category') {
    sortOption.value = sortOption.value === 'category_asc' ? 'category_desc' : 'category_asc';
  }
}

// Load locations and categories on mount
onMounted(async () => {
  await Promise.all([
    fetchLocations(),
    fetchCategories()
  ]);
});

// Fetch locations from API
async function fetchLocations() {
  loading.value = true;
  error.value = null;
  
  try {
    const data = await api.getLocations();
    locationsList.value = data;
  } catch (err) {
    console.error('Error fetching locations:', err);
    error.value = 'Failed to load locations. Please try again.';
  } finally {
    loading.value = false;
  }
}

// Modal functions
function openAddModal() {
  if (!canEdit.value) {
    showNotification('You do not have permission to add locations', 'error');
    return;
  }
  
  currentLocation.value = {
    id: null,
    name: '',
    description: '',
    type: 'poi',
    coordinates: [[0, 0]]
  };
  isNewLocation.value = true;
  showModal.value = true;
}

function openEditModal(location) {
  try {
    // Create a clean copy of the location to avoid reference issues
    const locationCopy = JSON.parse(JSON.stringify(location));
    
    // Make sure coordinates are properly formatted
    if (locationCopy.coordinates && !Array.isArray(locationCopy.coordinates)) {
      try {
        locationCopy.coordinates = JSON.parse(locationCopy.coordinates);
      } catch (e) {
        console.error("Failed to parse coordinates:", e);
        locationCopy.coordinates = [[0, 0]];
      }
    }
    
    currentLocation.value = locationCopy;
    isNewLocation.value = false;
    showModal.value = true;
  } catch (error) {
    console.error('Error opening edit modal:', error);
    showNotification('Failed to open editor: ' + error.message, 'error');
  }
}

function openDeleteModal(location) {
  if (!canDelete.value) {
    showNotification('You do not have permission to delete locations', 'error');
    return;
  }
  
  try {
    currentLocation.value = JSON.parse(JSON.stringify(location));
    isNewLocation.value = false;
    showModal.value = true;
  } catch (error) {
    console.error('Error opening delete modal:', error);
    showNotification('Failed to prepare location for deletion: ' + error.message, 'error');
  }
}

function closeModal() {
  showModal.value = false;
}

// CRUD operations with webhook logging
async function saveLocation(locationData) {
  if (!canEdit.value) {
    showNotification('You do not have permission to modify locations', 'error');
    return;
  }
  
  try {
    let savedLocation;
    
    if (isNewLocation.value) {
      // Create new location
      savedLocation = await api.createLocation(locationData);
      
      // Log to Discord webhook
      await webhook.sendLogToDiscord({
        action: 'create',
        user: authStore.user,
        data: savedLocation
      });
      
      showNotification('Location added successfully!');
    } else {
      // Update existing location
      savedLocation = await api.updateLocation(locationData.id, locationData);
      
      // Log to Discord webhook
      await webhook.sendLogToDiscord({
        action: 'update',
        user: authStore.user,
        data: savedLocation
      });
      
      showNotification('Location updated successfully!');
    }
    
    // Refresh locations list
    await fetchLocations();
    closeModal();
  } catch (err) {
    console.error('Error saving location:', err);
    showNotification('Failed to save location: ' + err.message, 'error');
  }
}

async function deleteLocation(locationId) {
  if (!canDelete.value) {
    showNotification('You do not have permission to delete locations', 'error');
    return;
  }
  
  try {
    // Get location details before deletion for logging
    const locationToDelete = locationsList.value.find(loc => loc.id === locationId);
    
    // Delete the location
    await api.deleteLocation(locationId);
    
    // Log to Discord webhook
    await webhook.sendLogToDiscord({
      action: 'delete',
      user: authStore.user,
      data: locationToDelete
    });
    
    showNotification('Location deleted successfully!');
    await fetchLocations();
    closeModal();
  } catch (err) {
    console.error('Error deleting location:', err);
    showNotification('Failed to delete location: ' + err.message, 'error');
  }
}

// Notification helper
function showNotification(message, type = 'success') {
  notification.value = {
    show: true,
    message,
    type
  };
  
  // Hide notification after 3 seconds
  setTimeout(() => {
    notification.value.show = false;
  }, 3000);
}
</script>

<style scoped>
.locations-container {
  padding: 20px 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.add-btn {
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-weight: 600;
  cursor: pointer;
}

.filters {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.category-filter, .sort-select {
  min-width: 160px;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.sort-options {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loading, .error, .no-results {
  text-align: center;
  padding: 40px;
  color: #666;
}

.retry-btn {
  background: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  margin-top: 10px;
  cursor: pointer;
}

.locations-table {
  width: 100%;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

th {
  background-color: #f9f9f9;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

th:hover {
  background-color: #eaeaea;
}

.sort-indicator {
  margin-left: 5px;
  font-size: 10px;
}

.name-cell {
  font-weight: 500;
}

.category-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
}

.town {
  background-color: #4caf50;
  color: white;
}

.poi {
  background-color: #2196f3;
  color: white;
}

.dungeon {
  background-color: #9c27b0;
  color: white;
}

.resource {
  background-color: #ff9800;
  color: white;
}

.social {
  background-color: #e91e63;
  color: white;
}

.boss {
  background-color: #f44336;
  color: white;
}

.quest {
  background-color: #673ab7;
  color: white;
}

.vendor {
  background-color: #009688;
  color: white;
}

.other {
  background-color: #607d8b;
  color: white;
}

.coords-cell .coord {
  font-family: monospace;
  margin-bottom: 2px;
}

.coord-summary {
  font-family: monospace;
}

.more-coords {
  display: inline-block;
  background: #f0f0f0;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: 4px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  background: #f0f0f0;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 12px;
}

.actions-cell {
  white-space: nowrap;
}

.edit-btn, .delete-btn {
  padding: 6px 10px;
  margin-right: 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.edit-btn {
  background: #3498db;
  color: white;
}

.delete-btn {
  background: #e74c3c;
  color: white;
}

.notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 4px;
  color: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  z-index: 1000;
}

.notification.success {
  background-color: #4caf50;
}

.notification.error {
  background-color: #e74c3c;
}
</style>
