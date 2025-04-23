<template>
  <div class="locations-container">
    <div class="header">
      <!-- <h2>Locations</h2> -->
      <!-- Remove button from here -->
      <!-- <button @click="openAddModal" class="add-btn">+ Add Location</button> -->
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
        <!-- Use clean categories for the dropdown options -->
        <option v-for="category in cleanCategories" :key="category" :value="category">{{ category }}</option>
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
          <tr 
            v-for="location in filteredLocations" 
            :key="location.id"
            @mouseenter="showTooltip(location, $event)" 
            @mouseleave="hideTooltip"
            @mousemove="updateTooltipPosition($event)"
            :class="{ 'disabled-row': isLocationDisabled(location) }" 
          >
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
              <span class="category-badge" :style="getCategoryStyle(getCleanCategory(location.type))">
                {{ getCleanCategory(location.type) }}
                <span v-if="isLocationDisabled(location)" class="disabled-indicator">(Disabled)</span>
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
              <button 
                @click="openEditModal(location)" 
                class="action-btn edit-btn" 
                :title="canEdit ? 'Edit location' : 'View location details'"
              >
                <i :class="canEdit ? 'fa-solid fa-pen-to-square' : 'fa-solid fa-eye'"></i>
              </button>
              <button 
                v-if="canEdit" 
                @click="toggleLocationVisibility(location)" 
                class="action-btn toggle-vis-btn"
                :class="{ 'enabled': !isLocationDisabled(location), 'disabled': isLocationDisabled(location) }"
                :title="isLocationDisabled(location) ? 'Enable location' : 'Disable location'"
              >
                <i :class="isLocationDisabled(location) ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
              </button>
              <button 
                v-if="canDelete" 
                @click="openDeleteModal(location)" 
                class="action-btn delete-btn"
                title="Delete location"
              >
                <i class="fa-solid fa-trash-alt"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Tooltip Element -->
    <div 
      v-if="tooltip.visible" 
      class="location-tooltip" 
      :style="{ top: tooltip.top + 'px', left: tooltip.left + 'px' }"
    >
      <h4>{{ tooltip.details.name }}</h4>
      <p v-if="tooltip.details.description"><strong>Desc:</strong> {{ truncateText(tooltip.details.description, 150) }}</p>
      <p v-if="tooltip.details.lore"><strong>Lore:</strong> {{ truncateText(tooltip.details.lore, 150) }}</p>
      <p v-if="tooltip.details.spoilers"><strong>Spoilers:</strong> {{ truncateText(tooltip.details.spoilers, 150) }}</p>
      <p v-if="tooltip.details.radius > 0"><strong>Radius:</strong> {{ tooltip.details.radius }}</p>
      <p v-if="tooltip.details.iconSize !== 1"><strong>Icon Size:</strong> {{ tooltip.details.iconSize }}</p>
      <p v-if="tooltip.details.noCluster"><strong>No Cluster:</strong> Yes</p>
      <p v-if="tooltip.details.isCoordinateSearch"><strong>Coord Search:</strong> Yes</p>
      <p v-if="tooltip.details.mediaUrl && tooltip.details.mediaUrl.length > 0"><strong>Media:</strong> {{ tooltip.details.mediaUrl.length }} item(s)</p>
      <p v-if="tooltip.details.submittedBy"><strong>Submitted By:</strong> {{ tooltip.details.submittedBy }}</p>
      <p v-if="tooltip.details.approvedBy"><strong>Approved By:</strong> {{ tooltip.details.approvedBy }}</p>
      <p><strong>Last Modified:</strong> {{ new Date(tooltip.details.updatedAt || tooltip.details.lastModified).toLocaleString() }}</p>
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
    
    <!-- Floating Add Button -->
    <button @click="openAddModal" class="fab-add-btn" title="Add Location">
      <i class="fa-solid fa-plus"></i>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import LocationEditModal from '../components/LocationEditModal.vue';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import webhook from '../services/webhook';
import { showNotification } from '../services/notificationService';

// State
const locationsList = ref([]);
const categories = ref([]); // Store categories exactly as from API (including disabled marker)
const cleanCategories = computed(() => { // New computed property for unique, clean category names
  const uniqueClean = new Set(categories.value.map(cat => getCleanCategory(cat)));
  return Array.from(uniqueClean).sort();
});
const categoryStyles = ref({}); // Stores { type: { backgroundColor, color } }
const loading = ref(true);
const error = ref(null);
const search = ref('');
const categoryFilter = ref('');
const sortOption = ref('name_asc');
const showModal = ref(false);
const currentLocation = ref({});
const isNewLocation = ref(false);

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

// Helper to check if location is disabled
function isLocationDisabled(location) {
  return location.type?.includes(DISABLED_MARKER) ?? false;
}

// Helper to get the category name without the disabled marker
function getCleanCategory(type) {
  return type?.replace(DISABLED_MARKER, '').trim() || 'Unknown';
}

// Get category style based on the *clean* type
function getCategoryStyle(type) {
  const cleanType = getCleanCategory(type); // Use clean type for styling
  if (!cleanType) return { backgroundColor: '#777', color: 'white' };
  
  if (!categoryStyles.value[cleanType]) {
    const hash = [...cleanType].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hue = hash % 360;
    categoryStyles.value[cleanType] = { 
      backgroundColor: `hsl(${hue}, 65%, 45%)`, 
      color: 'white' 
    };
  }
  
  return categoryStyles.value[cleanType];
}

// Fetch categories from the database exactly as they are
async function fetchCategories() {
  try {
    const categoryList = await api.getCategories();
    categories.value = categoryList; // Store exactly as received (including disabled marker)
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
      getCleanCategory(loc.type)?.toLowerCase().includes(searchLower) // Search clean category name
    );
  }
  
  // Filter by category (using clean category name)
  if (categoryFilter.value) {
    result = result.filter(loc => getCleanCategory(loc.type) === categoryFilter.value);
  }
  
  // Sort the results
  result.sort((a, b) => {
    const cleanTypeA = getCleanCategory(a.type);
    const cleanTypeB = getCleanCategory(b.type);
    
    switch (sortOption.value) {
      case 'name_asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name_desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'category_asc':
        // Sort by clean category name
        return cleanTypeA.localeCompare(cleanTypeB);
      case 'category_desc':
        // Sort by clean category name
        return cleanTypeB.localeCompare(cleanTypeA);
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
  
  // Set up SSE after initial data load
  setupSSEListener();
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
    displayNotification('You do not have permission to add locations', 'error');
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

// Update openEditModal to always fetch the latest data
async function openEditModal(location) {
  if (!canEdit.value && !location.id) {
    displayNotification('You do not have permission to add locations', 'error');
    return;
  }
  
  try {
    let locationCopy;
    
    // If editing an existing location, always fetch the latest data
    if (location.id) {
      try {
        // Fetch the latest data for this location
        const freshLocation = await api.getLocation(location.id);
        locationCopy = JSON.parse(JSON.stringify(freshLocation || location));
      } catch (error) {
        console.error('Failed to fetch latest location data:', error);
        locationCopy = JSON.parse(JSON.stringify(location));
      }
    } else {
      locationCopy = JSON.parse(JSON.stringify(location));
    }
    
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
    isNewLocation.value = !location.id;
    showModal.value = true;
  } catch (error) {
    console.error('Error opening edit modal:', error);
    displayNotification('Failed to open editor: ' + error.message, 'error');
  }
}

function openDeleteModal(location) {
  if (!canDelete.value) {
    displayNotification('You do not have permission to delete locations', 'error');
    return;
  }
  
  try {
    currentLocation.value = JSON.parse(JSON.stringify(location));
    isNewLocation.value = false;
    showModal.value = true;
  } catch (error) {
    console.error('Error opening delete modal:', error);
    displayNotification('Failed to prepare location for deletion: ' + error.message, 'error');
  }
}

function closeModal() {
  showModal.value = false;
}

// CRUD operations with webhook logging
async function saveLocation(locationData) {
  if (!canEdit.value) {
    displayNotification('You do not have permission to modify locations', 'error');
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
      
      displayNotification('Location added successfully!');
    } else {
      // For updates, find the original location to track changes
      const originalLocation = locationsList.value.find(loc => loc.id === locationData.id);
      
      // Update existing location
      savedLocation = await api.updateLocation(locationData.id, locationData);
      
      // Log to Discord webhook with before/after data
      await webhook.sendLogToDiscord({
        action: 'update',
        user: authStore.user,
        data: savedLocation,
        oldData: originalLocation
      });
      
      displayNotification('Location updated successfully!');
    }
    
    // Refresh locations list
    await fetchLocations();
    closeModal();
  } catch (err) {
    console.error('Error saving location:', err);
    displayNotification('Failed to save location: ' + err.message, 'error');
  }
}

async function deleteLocation(locationId) {
  if (!canDelete.value) {
    displayNotification('You do not have permission to delete locations', 'error');
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
    
    displayNotification('Location deleted successfully!');
    await fetchLocations();
    closeModal();
  } catch (err) {
    console.error('Error deleting location:', err);
    displayNotification('Failed to delete location: ' + err.message, 'error');
  }
}

// Notification helper
function displayNotification(message, type = 'success') {
  showNotification(message, type);
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

// Add SSE connection for real-time updates
let eventSource = null;

// Set up SSE listener for location changes
function setupSSEListener() {
  try {
    const sseUrl = '/api/listen';
    eventSource = new EventSource(sseUrl);
    
    eventSource.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'change' && message.resource === 'location') {
          console.log('SSE: Location change detected, refreshing locations...');
          await fetchLocations();
          
          // If we're currently editing the changed location, refresh its data
          if (showModal.value && !isNewLocation.value && message.id === currentLocation.value.id) {
            console.log('SSE: Currently editing the changed location, refreshing details...');
            try {
              const updatedLocation = await api.getLocation(message.id);
              if (updatedLocation) {
                currentLocation.value = updatedLocation;
              }
            } catch (error) {
              console.error('Failed to refresh location details:', error);
            }
          }
        } else if (message.type === 'connected') {
          console.log('SSE: Connected to location updates.');
        }
      } catch (error) {
        console.error('SSE: Error parsing message:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE: Connection error:', error);
      // Try to reconnect after a delay
      setTimeout(() => {
        if (eventSource) {
          eventSource.close();
          setupSSEListener();
        }
      }, 5000);
    };
  } catch (error) {
    console.error('Failed to initialize SSE:', error);
  }
}

// Clean up SSE connection on unmount
onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    console.log('SSE: Connection closed.');
  }
});

// Tooltip State
const tooltip = ref({
  visible: false,
  details: null,
  top: 0,
  left: 0,
  timer: null // Timer for delayed appearance
});

// Tooltip Functions
function showTooltip(location, event) {
  // Debounce or delay showing the tooltip
  clearTimeout(tooltip.value.timer); 
  tooltip.value.timer = setTimeout(() => {
    tooltip.value.details = location;
    updateTooltipPosition(event); // Set initial position
    tooltip.value.visible = true;
  }, 300); // 300ms delay
}

function hideTooltip() {
  clearTimeout(tooltip.value.timer);
  tooltip.value.visible = false;
  tooltip.value.details = null;
}

function updateTooltipPosition(event) {
  if (!tooltip.value.visible) return;
  // Position tooltip slightly offset from the cursor
  const offsetX = 15;
  const offsetY = 15;
  tooltip.value.top = event.clientY + offsetY;
  tooltip.value.left = event.clientX + offsetX;

  // TODO: Add boundary checks to prevent tooltip going off-screen
}

// Helper to truncate long text
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Define the disable marker constant
const DISABLED_MARKER = '![DISABLED]';

// Function to toggle location visibility
async function toggleLocationVisibility(location) {
  if (!canEdit.value) {
    displayNotification('You do not have permission to modify locations', 'error');
    return;
  }

  const currentlyDisabled = isLocationDisabled(location);
  const originalType = getCleanCategory(location.type);
  const newType = currentlyDisabled ? originalType : `${DISABLED_MARKER} ${originalType}`;
  const action = currentlyDisabled ? 'enable' : 'disable';

  try {
    // Prepare minimal update data
    const updateData = { id: location.id, type: newType };
    
    // Update the location type via API
    const updatedLocation = await api.updateLocation(location.id, updateData);
    
    // Log to Discord webhook
    await webhook.sendLogToDiscord({
      action: action, // Use 'enable' or 'disable'
      user: authStore.user,
      data: { ...location, type: newType }, // Show the new type
      oldData: location // Show the old state
    });
    
    displayNotification(`Location ${action}d successfully!`);
    
    // Refresh locations list locally for immediate UI update
    const index = locationsList.value.findIndex(loc => loc.id === location.id);
    if (index !== -1) {
      locationsList.value[index].type = newType;
      // Trigger reactivity if needed, though direct modification should work with Vue 3 refs
      locationsList.value = [...locationsList.value]; 
    } else {
      // If not found (e.g., due to filtering), fetch full list
      await fetchLocations();
    }

  } catch (err) {
    console.error(`Error ${action}ing location:`, err);
    displayNotification(`Failed to ${action} location: ${err.message}`, 'error');
    // Optionally revert local change on error
    // const index = locationsList.value.findIndex(loc => loc.id === location.id);
    // if (index !== -1) locationsList.value[index].type = location.type;
  }
}
</script>

<style scoped>
.locations-container {
  padding: 20px 15px; /* Add horizontal padding */
  position: relative; /* Needed if any child uses absolute positioning relative to this */
  max-width: 1200px; /* Limit maximum width */
  margin: 0 auto; /* Center the container */
  box-sizing: border-box; /* Include padding in width calculation */
}

.header {
  display: flex;
  justify-content: flex-start; /* Align title/elements to the start */
  align-items: center;
  margin-bottom: 20px;
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
  table-layout: fixed; /* Use fixed layout */
}

th, td {
  padding: 12px 16px;
  text-align: left;
  /* Remove border-bottom from individual cells */
  /* border-bottom: 1px solid #eee; */
  overflow: hidden; /* Prevent content overflow */
  text-overflow: ellipsis; /* Add ellipsis for overflow */
  vertical-align: middle; /* Vertically center content */
  line-height: 1.5; /* Consistent line height */
}

th {
  background-color: #f9f9f9;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #ddd; /* Keep header bottom border */
}

/* Column specific styles */
.icon-cell {
  width: 50px; /* Reduced width */
  text-align: center;
}

/* Apply the same width to the header cell for the icon column */
th:first-child { /* Target the first header cell (Icon) */
  width: 50px;
  text-align: center; /* Ensure header text is also centered */
}

.name-cell {
  font-weight: 500;
  width: 25%;
  white-space: nowrap; /* Prevent name wrapping */
}

.category-cell {
  width: 20%;
  white-space: nowrap;
}

.coords-cell {
  width: 25%;
  font-family: monospace;
}

.actions-cell {
  width: 130px; /* Fixed width for actions */
  white-space: nowrap;
  display: flex;
  gap: 8px;
  align-items: center; /* Vertically center buttons */
  justify-content: flex-start; /* Align buttons to the start */
  /* border-bottom is handled by the td rule */
}

/* Icon styles */
.location-icon {
  display: inline-flex; /* Use inline-flex for alignment */
  align-items: center;
  justify-content: center;
  width: 28px; /* Increased width */
  height: 28px; /* Increased height */
  vertical-align: middle; /* Align with text if needed */
}

.location-icon.svg-icon {
  object-fit: contain; /* Ensure SVG scales correctly */
}

.location-icon.fa-icon {
  font-size: 20px; /* Increased Font Awesome icon size */
}

.no-icon {
  display: inline-block;
  width: 28px; /* Match icon size */
  text-align: center;
  font-weight: bold;
  color: #ccc;
  font-size: 20px; /* Match icon size */
}

/* Category badge */
.category-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
  white-space: nowrap;
}

.category-badge .disabled-indicator {
  font-weight: normal;
  font-style: italic;
  opacity: 0.8;
  margin-left: 4px;
  font-size: 0.9em;
}

/* Coordinates display */
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

/* Action Buttons */
.action-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex; /* Use flex for centering icon */
  align-items: center;
  justify-content: center;
  font-size: 16px; /* Icon size */
  transition: all 0.2s ease;
  color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  flex-shrink: 0; /* Prevent shrinking */
}

.action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
}

.edit-btn {
  background-color: #3498db; /* Blue */
}
.edit-btn:hover {
  background-color: #2980b9;
}

.toggle-vis-btn.enabled {
  background-color: #2ecc71; /* Green */
}
.toggle-vis-btn.enabled:hover {
  background-color: #27ae60;
}

.toggle-vis-btn.disabled {
  background-color: #95a5a6; /* Gray */
}
.toggle-vis-btn.disabled:hover {
  background-color: #7f8c8d;
}

.delete-btn {
  background-color: #e74c3c; /* Red */
}
.delete-btn:hover {
  background-color: #c0392b;
}

/* Tooltip */
.location-tooltip {
  position: fixed;
  background-color: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 10px 15px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 300px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  z-index: 1100;
  pointer-events: none;
  white-space: normal;
  opacity: 1;
  transition: opacity 0.2s ease-in-out;
}

.location-tooltip h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  border-bottom: 1px solid #555;
  padding-bottom: 4px;
}

.location-tooltip p {
  margin: 4px 0;
}

.location-tooltip strong {
  color: #aaa;
}

/* Row styles */
tbody tr { /* Apply border to the table row */
  border-bottom: 1px solid #eee;
}

tbody tr:hover {
  background-color: #f8f9fa;
}

.disabled-row {
  opacity: 0.6;
  background-color: #f8f8f8;
  transition: opacity 0.2s ease-in-out, background-color 0.2s ease-in-out;
}
.disabled-row:hover {
  opacity: 0.9;
  background-color: #f0f0f0;
}

/* Floating Add Button */
.fab-add-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: #2196F3;
  color: white;
  border: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 100;
}

.fab-add-btn:hover {
  background-color: #1976D2;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  transform: scale(1.05);
}

.fab-add-btn i {
  font-size: 24px;
}

/* Removed duplicate/conflicting styles */
/* Removed duplicate .actions-cell */
/* Removed duplicate .action-btn */
/* Removed duplicate .edit-btn, .toggle-vis-btn, .delete-btn hover/color styles */
/* Removed duplicate td vertical-align */
/* Removed duplicate icon sizing/alignment styles */
</style>
