<template>
  <div class="modal-backdrop" @click="closeModal">
    <div class="modal-content" @click.stop>
      <h2>{{ isNew ? 'Add New Location' : 'Edit Location' }}</h2>
      
      <form @submit.prevent="saveLocation" class="location-form">
        <div class="form-group">
          <label for="name">Name:</label>
          <input type="text" id="name" v-model="formData.name" required>
        </div>
        
        <div class="form-group">
          <label for="type">Category:</label>
          <div class="category-autocomplete">
            <input 
              type="text" 
              id="type" 
              v-model="categoryInput" 
              @input="onCategoryInput" 
              @focus="showCategorySuggestions = true" 
              @blur="onCategoryBlur"
              @keydown.enter.prevent="selectCategorySuggestion(formData.type)"
              @keydown.down.prevent="navigateSuggestion(1)"
              @keydown.up.prevent="navigateSuggestion(-1)"
              placeholder="Type or select a category"
            >
            <div v-if="showCategorySuggestions && filteredCategories.length > 0" class="category-suggestions">
              <div 
                v-for="(category, index) in filteredCategories" 
                :key="category" 
                class="category-suggestion" 
                :class="{ 'selected': index === selectedSuggestionIndex }"
                @mousedown.prevent="selectCategorySuggestion(category)"
                @mouseover="selectedSuggestionIndex = index"
              >
                {{ category }}
              </div>
            </div>
          </div>
        </div>
        
        <div class="form-group">
          <label for="description">Description:</label>
          <textarea id="description" v-model="formData.description" rows="3"></textarea>
        </div>
        
        <div class="form-group coordinates-section">
          <label>Coordinates:</label>
          <div v-for="(coords, index) in formData.coordinates" :key="index" class="coords-row">
            <div class="coord-container">
              <input type="text" 
                     v-model="formData.coordinates[index]" 
                     @input="validateCoordinates(index)" 
                     placeholder="[X, Y]"
                     class="coord-input">
              <button type="button" @click="removeCoordinate(index)" class="remove-btn">✕</button>
            </div>
            <div class="error-message" v-if="coordinateErrors[index]">
              {{ coordinateErrors[index] }}
            </div>
          </div>
          
          <div class="coords-actions">
            <button type="button" @click="addCoordinate" class="add-btn">+ Add Coordinate</button>
            <button type="button" @click="parseCoordinates" class="parse-btn">Parse Bulk Coordinates</button>
          </div>
        </div>

        <div class="form-section">
          <h3>Appearance</h3>
          
          <div class="form-group">
            <IconPicker v-model="formData.icon" />
          </div>
          
          <div class="form-group">
            <label for="iconSize">Icon Size:</label>
            <input type="number" id="iconSize" v-model.number="formData.iconSize" min="0" step="0.1">
          </div>
          
          <div class="form-group">
            <label for="iconColor">Icon Color:</label>
            <input type="color" id="iconColor" v-model="formData.iconColor" class="color-input">
          </div>
          
          <div class="form-group">
            <label for="radius">Radius:</label>
            <input type="number" id="radius" v-model.number="formData.radius" min="0" step="1">
          </div>
        </div>
        
        <div class="form-section">
          <h3>Additional Information</h3>
          
          <div class="form-group">
            <label for="lore">Lore:</label>
            <textarea id="lore" v-model="formData.lore" rows="3"></textarea>
          </div>
          
          <div class="form-group">
            <label for="spoilers">Spoilers:</label>
            <textarea id="spoilers" v-model="formData.spoilers" rows="3"></textarea>
          </div>
          
          <div class="form-group">
            <label for="mediaUrl">Media URLs:</label>
            <textarea id="mediaUrl" v-model="mediaUrlsText" rows="2" placeholder="Enter URLs separated by commas or new lines"></textarea>
            <p class="help-text">Enter image/video URLs separated by commas or new lines</p>
          </div>
        </div>
        
        <div class="form-section">
          <h3>Display Options</h3>
          
          <div class="form-group checkbox-group">
            <input type="checkbox" id="noCluster" v-model="formData.noCluster">
            <label for="noCluster">Prevent Clustering</label>
          </div>
          
          <div class="form-group checkbox-group">
            <input type="checkbox" id="isCoordinateSearch" v-model="formData.isCoordinateSearch">
            <label for="isCoordinateSearch">Is Coordinate Search</label>
          </div>
          
          <div class="form-group" v-if="formData.isCoordinateSearch">
            <label for="exactCoordinates">Exact Coordinates (for search):</label>
            <textarea id="exactCoordinates" v-model="exactCoordinatesText" rows="2"></textarea>
            <p class="help-text">Enter exact coordinates in [X, Y] format, separated by commas</p>
          </div>
        </div>
        
        <div class="form-actions">
          <button type="button" @click="closeModal" class="btn-cancel">Cancel</button>
          <button type="submit" class="btn-save">Save</button>
          
          <button 
            v-if="!isNew && canDelete" 
            type="button" 
            @click="confirmDelete"
            class="btn-delete"
          >
            Delete
          </button>
        </div>
      </form>
      
      <!-- Bulk coordinate parser modal -->
      <div v-if="showBulkParser" class="bulk-parser">
        <h3>Enter Multiple Coordinates</h3>
        <p>Enter one [X, Y] coordinate per line or separated by commas</p>
        <textarea v-model="bulkCoordinates" rows="5" placeholder="[123, 456]&#10;[789, 012]"></textarea>
        <div class="parser-actions">
          <button @click="showBulkParser = false" class="btn-cancel">Cancel</button>
          <button @click="processBulkCoordinates" class="btn-save">Add Coordinates</button>
        </div>
      </div>
      
      <!-- Confirmation dialog -->
      <div v-if="showDeleteConfirm" class="delete-confirm">
        <h3>Confirm Deletion</h3>
        <p>Are you sure you want to delete this location? This action cannot be undone.</p>
        <div class="confirm-actions">
          <button @click="showDeleteConfirm = false" class="btn-cancel">Cancel</button>
          <button @click="deleteLocation" class="btn-delete">Delete Permanently</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import IconPicker from './IconPicker.vue';

// Fetch available categories
const categories = ref([]);
async function fetchCategories() {
  try {
    const categoryList = await api.getCategories();
    categories.value = categoryList; // Store categories exactly as received
  } catch (error) {
    console.error('Failed to load categories:', error);
    categories.value = ['poi']; // Fallback
  }
}

onMounted(() => {
  fetchCategories();
});

// Category autocomplete logic
const categoryInput = ref('');
const showCategorySuggestions = ref(false);
const selectedSuggestionIndex = ref(-1);

// Filter categories based on input
const filteredCategories = computed(() => {
  if (!categoryInput.value) {
    return categories.value;
  }
  
  const inputLower = categoryInput.value.toLowerCase();
  return categories.value.filter(category => 
    category.toLowerCase().includes(inputLower)
  );
});

function onCategoryInput() {
  showCategorySuggestions.value = true;
  selectedSuggestionIndex.value = -1;
  formData.value.type = categoryInput.value;
}

function selectCategorySuggestion(category) {
  formData.value.type = category;
  categoryInput.value = category;
  showCategorySuggestions.value = false;
}

function onCategoryBlur() {
  // Small delay to allow click on suggestion to register before closing
  setTimeout(() => {
    showCategorySuggestions.value = false;
  }, 150);
}

function navigateSuggestion(direction) {
  if (!filteredCategories.value.length) return;
  
  if (direction > 0) {
    selectedSuggestionIndex.value = 
      (selectedSuggestionIndex.value + 1) % filteredCategories.value.length;
  } else {
    selectedSuggestionIndex.value = 
      (selectedSuggestionIndex.value - 1 + filteredCategories.value.length) % filteredCategories.value.length;
  }
  
  if (selectedSuggestionIndex.value >= 0) {
    formData.value.type = filteredCategories.value[selectedSuggestionIndex.value];
  }
}

const props = defineProps({
  location: {
    type: Object,
    default: () => ({
      id: null,
      name: '',
      description: '',
      type: 'poi',
      coordinates: ['[0, 0]'],
      icon: null,
      iconSize: 1,
      iconColor: '#ffffff',
      radius: 0,
      lore: '',
      spoilers: '',
      mediaUrl: [],
      isCoordinateSearch: false,
      noCluster: false,
      exactCoordinates: null
    })
  },
  isNew: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['save', 'close', 'delete']);
const authStore = useAuthStore();

// Normalize coordinate format to be consistent
function normalizeCoordinates(coords) {
  if (!coords || (!Array.isArray(coords) && typeof coords !== 'string')) {
    return ['[0, 0]'];
  }
  
  // Handle complex coordinates (array of coordinate pairs)
  if (Array.isArray(coords) && coords.length > 0) {
    // Check if it's already an array of strings in [x, y] format
    if (typeof coords[0] === 'string' && /^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/.test(coords[0])) {
      return coords;
    }
    
    // Check if it's an array of arrays (complex coordinates)
    if (Array.isArray(coords[0])) {
      // Check if it's in format [[x,y],[x,y],...]
      if (coords[0].length === 2 && typeof coords[0][0] === 'number') {
        return coords.map(pair => `[${pair[0]}, ${pair[1]}]`);
      }
      
      // It could be a nested array of arrays
      try {
        // Flatten one level if needed
        const flattened = coords.flat();
        if (flattened.length >= 2 && typeof flattened[0] === 'number') {
          const result = [];
          for (let i = 0; i < flattened.length; i += 2) {
            if (i + 1 < flattened.length) {
              result.push(`[${flattened[i]}, ${flattened[i+1]}]`);
            }
          }
          return result.length > 0 ? result : ['[0, 0]'];
        }
      } catch (e) {
        console.error("Error processing nested coordinates:", e);
      }
    }
    
    // Handle flat array of numbers [x, y, x, y, ...]
    if (typeof coords[0] === 'number') {
      const result = [];
      for (let i = 0; i < coords.length; i += 2) {
        if (i + 1 < coords.length) {
          result.push(`[${coords[i]}, ${coords[i+1]}]`);
        }
      }
      return result.length > 0 ? result : ['[0, 0]'];
    }
  }
  
  // If it's a string, try to parse it
  if (typeof coords === 'string') {
    try {
      // Check if it's a single coordinate string like "[x,y]"
      if (/^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/.test(coords)) {
        return [coords];
      }
      
      // Try parsing as JSON (could be stringified array)
      const parsed = JSON.parse(coords);
      return normalizeCoordinates(parsed);
    } catch (e) {
      console.error("Failed to parse coordinates:", e);
      return ['[0, 0]'];
    }
  }
  
  // Default fallback
  return ['[0, 0]'];
}

// Process media URLs
const mediaUrlsText = ref('');
function parseMediaUrls(mediaUrl) {
  if (!mediaUrl) return '';
  
  if (Array.isArray(mediaUrl)) {
    return mediaUrl.join('\n');
  } else if (typeof mediaUrl === 'string') {
    try {
      const parsed = JSON.parse(mediaUrl);
      if (Array.isArray(parsed)) {
        return parsed.join('\n');
      }
      return mediaUrl;
    } catch (e) {
      return mediaUrl;
    }
  } else if (typeof mediaUrl === 'object') {
    try {
      return JSON.stringify(mediaUrl);
    } catch (e) {
      return '';
    }
  }
  
  return '';
}

function processMediaUrlsForSaving() {
  if (!mediaUrlsText.value) return [];
  
  // Split by commas or newlines
  const urls = mediaUrlsText.value.split(/[\n,]+/).map(url => url.trim()).filter(Boolean);
  return urls.length > 0 ? urls : [];
}

// Process exact coordinates
const exactCoordinatesText = ref('');
function parseExactCoordinates(exactCoords) {
  if (!exactCoords) return '';
  
  try {
    if (typeof exactCoords === 'string') {
      return exactCoords;
    } else if (Array.isArray(exactCoords)) {
      return exactCoords.map(coord => 
        Array.isArray(coord) ? `[${coord[0]}, ${coord[1]}]` : coord
      ).join('\n');
    } else {
      return JSON.stringify(exactCoords);
    }
  } catch (e) {
    console.error("Error parsing exact coordinates:", e);
    return '';
  }
}

function processExactCoordinatesForSaving() {
  if (!exactCoordinatesText.value) return null;
  
  try {
    // Parse the text into proper coordinates format
    const coordStrings = exactCoordinatesText.value
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    
    if (coordStrings.length === 0) return null;
    
    const coords = coordStrings.map(coordStr => {
      const match = coordStr.match(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
      if (match) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
      }
      return null;
    }).filter(Boolean);
    
    return coords.length > 0 ? coords : null;
  } catch (e) {
    console.error("Error processing exact coordinates:", e);
    return null;
  }
}

// Ensure we have valid data with defaults for missing properties
const ensureValidLocation = (loc) => {
  return {
    id: loc.id || null,
    name: loc.name || '',
    description: loc.description || '',
    type: loc.type || 'poi',
    coordinates: normalizeCoordinates(loc.coordinates),
    icon: loc.icon || null,
    iconSize: loc.iconSize !== undefined ? loc.iconSize : 1,
    iconColor: loc.iconColor || '#ffffff',
    radius: loc.radius !== undefined ? loc.radius : 0,
    lore: loc.lore || '',
    spoilers: loc.spoilers || '',
    mediaUrl: loc.mediaUrl || [],
    isCoordinateSearch: !!loc.isCoordinateSearch,
    noCluster: !!loc.noCluster,
    exactCoordinates: loc.exactCoordinates || null
  };
};

// Form data with validated location
const safeLocation = ensureValidLocation(props.location);
const formData = ref({
  id: safeLocation.id,
  name: safeLocation.name,
  description: safeLocation.description,
  type: safeLocation.type,
  coordinates: safeLocation.coordinates,
  icon: safeLocation.icon,
  iconSize: safeLocation.iconSize,
  iconColor: safeLocation.iconColor,
  radius: safeLocation.radius,
  lore: safeLocation.lore,
  spoilers: safeLocation.spoilers,
  isCoordinateSearch: safeLocation.isCoordinateSearch,
  noCluster: safeLocation.noCluster
});

// Initialize category input with the current type
categoryInput.value = formData.value.type || '';

// Set media URLs and exact coordinates text
mediaUrlsText.value = parseMediaUrls(safeLocation.mediaUrl);
exactCoordinatesText.value = parseExactCoordinates(safeLocation.exactCoordinates);

// Handling coordinates
const coordinateErrors = ref(Array(formData.value.coordinates.length).fill(null));
const showBulkParser = ref(false);
const bulkCoordinates = ref('');

// Delete confirmation
const showDeleteConfirm = ref(false);

// Check if user has admin role for deletion permission
const canDelete = computed(() => {
  // Admin role ID
  const ADMIN_ROLE_ID = '1309700533749289012';
  return authStore.user?.roles?.includes(ADMIN_ROLE_ID);
});

// Watch for changes in the location prop
watch(() => props.location, (newLocation) => {
  const validLocation = ensureValidLocation(newLocation);
  formData.value = {
    id: validLocation.id,
    name: validLocation.name,
    description: validLocation.description,
    type: validLocation.type,
    coordinates: validLocation.coordinates,
    icon: validLocation.icon,
    iconSize: validLocation.iconSize,
    iconColor: validLocation.iconColor,
    radius: validLocation.radius,
    lore: validLocation.lore,
    spoilers: validLocation.spoilers,
    isCoordinateSearch: validLocation.isCoordinateSearch,
    noCluster: validLocation.noCluster
  };
  
  // Update category input when location changes
  categoryInput.value = validLocation.type || '';
  
  coordinateErrors.value = Array(formData.value.coordinates.length).fill(null);
  mediaUrlsText.value = parseMediaUrls(validLocation.mediaUrl);
  exactCoordinatesText.value = parseExactCoordinates(validLocation.exactCoordinates);
}, { deep: true });

// Validate coordinates format [X, Y]
function validateCoordinates(index) {
  const coordRegex = /^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/;
  const value = formData.value.coordinates[index];
  
  if (!value || coordRegex.test(value)) {
    // Valid format or empty
    if (coordinateErrors.value[index]) {
      coordinateErrors.value[index] = null;
    }
    return true;
  } else {
    coordinateErrors.value[index] = 'Invalid format. Use [X, Y] format.';
    return false;
  }
}

function validateAllCoordinates() {
  let isValid = true;
  formData.value.coordinates.forEach((_, index) => {
    if (!validateCoordinates(index)) {
      isValid = false;
    }
  });
  return isValid;
}

function addCoordinate() {
  formData.value.coordinates.push('[0, 0]');
  coordinateErrors.value.push(null);
}

function removeCoordinate(index) {
  if (formData.value.coordinates.length > 1) {
    formData.value.coordinates.splice(index, 1);
    coordinateErrors.value.splice(index, 1);
  }
}

function parseCoordinates() {
  showBulkParser.value = true;
}

function processBulkCoordinates() {
  // Split by newlines or commas
  const coordsText = bulkCoordinates.value;
  const coordsArray = coordsText.split(/[\n,]+/).filter(text => text.trim());
  
  // Process each potential coordinate
  coordsArray.forEach(coord => {
    const trimmed = coord.trim();
    // Check if it's a valid coordinate format
    if (/^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/.test(trimmed)) {
      formData.value.coordinates.push(trimmed);
      coordinateErrors.value.push(null);
    }
  });
  
  // Close the bulk parser
  showBulkParser.value = false;
  bulkCoordinates.value = '';
}

// Convert string coordinates back to array for saving
function prepareCoordinatesForSaving(coordinates) {
  if (coordinates.length === 1) {
    // Single coordinate case - return as [x, y]
    const match = coordinates[0].match(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    return [0, 0]; // Fallback
  } else {
    // Multiple coordinates case - return as [[x,y], [x,y], ...]
    return coordinates.map(coord => {
      const match = coord.match(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
      if (match) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
      }
      return [0, 0]; // Fallback
    });
  }
}

// Save location
function saveLocation() {
  if (!validateAllCoordinates()) {
    return;
  }
  
  // Prepare data for saving
  const saveData = { ...formData.value };
  
  // Convert string coordinates to array format for database
  saveData.coordinates = prepareCoordinatesForSaving(saveData.coordinates);
  
  // Process media URLs and exact coordinates
  saveData.mediaUrl = processMediaUrlsForSaving();
  saveData.exactCoordinates = processExactCoordinatesForSaving();
  
  emit('save', saveData);
}

// Delete location
function confirmDelete() {
  showDeleteConfirm.value = true;
}

function deleteLocation() {
  emit('delete', formData.value.id);
  showDeleteConfirm.value = false;
}

// Close modal
function closeModal() {
  emit('close');
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

h2 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 12px;
  color: #2c3e50;
}

.location-form {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .location-form {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  
  .coordinates-section {
    grid-column: span 2;
  }
}

.form-section {
  margin-bottom: 16px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 6px;
}

.form-section h3 {
  margin-top: 0;
  margin-bottom: 12px;
  font-size: 16px;
  color: #444;
}

.form-group {
  margin-bottom: 16px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.checkbox-group {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.checkbox-group input {
  margin-right: 8px;
}

.checkbox-group label {
  margin-bottom: 0;
  font-weight: normal;
}

input[type="text"],
input[type="number"],
textarea,
select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.color-input {
  height: 40px;
  padding: 4px;
  cursor: pointer;
}

.coords-row {
  margin-bottom: 8px;
}

.coord-container {
  display: flex;
  gap: 8px;
}

.coord-input {
  flex: 1;
  font-family: monospace;
}

.remove-btn {
  background: #f1f1f1;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-message {
  color: #e74c3c;
  font-size: 12px;
  margin-top: 4px;
}

.coords-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.add-btn,
.parse-btn {
  background: #f8f9fa;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}

.add-btn:hover,
.parse-btn:hover {
  background: #e9ecef;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
  grid-column: span 2;
}

.btn-cancel,
.btn-save,
.btn-delete {
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.btn-cancel {
  background: #f1f2f3;
  color: #333;
}

.btn-save {
  background: #4caf50;
  color: white;
}

.btn-delete {
  background: #e74c3c;
  color: white;
  margin-left: auto; /* Push to left side */
}

.help-text {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

/* Bulk coordinate parser modal */
.bulk-parser,
.delete-confirm {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: white;
  padding: 20px;
  border-radius: 8px;
  width: 80%;
  max-width: 500px;
  z-index: 1100;
  box-shadow: 0 8px 30px rgba(0,0,0,0.3);
}

.bulk-parser h3,
.delete-confirm h3 {
  margin-top: 0;
}

.bulk-parser textarea {
  width: 100%;
  resize: vertical;
  margin: 10px 0;
  font-family: monospace;
}

.parser-actions,
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

/* Category autocomplete styling */
.category-autocomplete {
  position: relative;
}

.category-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: white;
  border: 1px solid #ddd;
  border-top: none;
  border-radius: 0 0 4px 4px;
  z-index: 10;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.category-suggestion {
  padding: 8px 12px;
  cursor: pointer;
}

.category-suggestion:hover,
.category-suggestion.selected {
  background-color: #f0f7ff;
}
</style>
