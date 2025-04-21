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
        <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
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
            <th>Icon</th>
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="location in filteredLocations" :key="location.id">
            <td class="icon-cell">
              <!-- Font Awesome icon -->
              <i 
                v-if="location.icon && (location.icon.startsWith('fa-') || location.icon.startsWith('fas ') || location.icon.startsWith('far '))" 
                :class="location.icon" 
                :style="{ color: location.iconColor || '#ffffff' }"
                class="location-icon fa-icon"
              ></i>
              <!-- SVG icon from server -->
              <img 
                v-else-if="location.icon && location.icon.startsWith('/')" 
                :src="getSvgIconUrl(location.icon)"
                :alt="location.name"
                class="location-icon svg-icon"
                @error="onIconLoadError"
              >
              <!-- No icon available -->
              <span v-else class="no-icon">•</span>
            </td>
            <td class="name-cell">{{ location.name }}</td>
            <td class="category-cell">
              <span class="category-badge" :style="getCategoryStyle(location.type)">
                {{ location.type }}
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
const locationsList = ref([]);
const categories = ref([]); // Store categories exactly as from API
const categoryStyles = ref({}); // Stores { type: { backgroundColor, color } }
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

// Get category style based on the type
function getCategoryStyle(type) {
  if (!type) return { backgroundColor: '#777', color: 'white' };
  
  // Return the existing style or generate one if not yet created
  if (!categoryStyles.value[type]) {
    // Generate a reproducible color based on the type string
    const hash = [...type].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hue = hash % 360;
    categoryStyles.value[type] = { 
      backgroundColor: `hsl(${hue}, 65%, 45%)`, 
      color: 'white' 
    };
  }
  
  return categoryStyles.value[type];
}

// Fetch categories from the database exactly as they are
async function fetchCategories() {
  try {
    const categoryList = await api.getCategories();
    categories.value = categoryList; // Store exactly as received
  } catch (error) {
    console.error('Error fetching categories:', error);
    categories.value = [];
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
      loc.type?.toLowerCase().includes(searchLower)
    );
  }
  
  // Filter by category (exact match)
  if (categoryFilter.value) {
    result = result.filter(loc => loc.type === categoryFilter.value);
  }
  
  // Sort the results
  result.sort((a, b) => {
    switch (sortOption.value) {
      case 'name_asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name_desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'category_asc':
        return (a.type || '').localeCompare(b.type || '');
      case 'category_desc':
        return (b.type || '').localeCompare(a.type || '');
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
    type: categories.value.length > 0 ? categories.value[0] : 'poi',
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

// Function to get SVG icon URL
function getSvgIconUrl(iconPath) {
  if (!iconPath || !iconPath.startsWith('/')) return '';
  return `https://soulmap.avakot.org${iconPath}.svg`;
}

// Handle error when icon fails to load
function onIconLoadError(event) {
  console.warn('Failed to load location icon:', event.target.src);
  event.target.style.display = 'none';
  event.target.nextElementSibling = document.createElement('span');
  event.target.nextElementSibling.className = 'no-icon';
  event.target.nextElementSibling.textContent = '•';
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
  /* Colors are now applied via :style binding */
}

/* Remove specific category styles */
/* .town { ... } */
/* .poi { ... } */
/* .dungeon { ... } */
/* .resource { ... } */
/* .social { ... } */
/* .boss { ... } */
/* .quest { ... } */
/* .vendor { ... } */
/* .other { ... } */

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

.icon-cell {
  width: 40px;
  text-align: center;
  vertical-align: middle;
}

.location-icon {
  width: 24px;
  height: 24px;
  display: inline-block;
}

.fa-icon {
  font-size: 20px;
  line-height: 24px;
}

.svg-icon {
  object-fit: contain;
}

.no-icon {
  display: inline-block;
  font-size: 24px;
  line-height: 24px;
  color: #ccc;
}
</style>
