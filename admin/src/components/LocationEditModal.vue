<template>
  <div class="modal-backdrop" @click="closeModal">
    <div class="modal-content" @click.stop>
      <h2>{{ isNew ? 'Add New Location' : 'Edit Location' }}</h2>
      
      <form @submit.prevent="saveLocation">
        <div class="form-group">
          <label for="name">Name:</label>
          <input type="text" id="name" v-model="formData.name" required>
        </div>
        
        <div class="form-group">
          <label for="description">Description:</label>
          <textarea id="description" v-model="formData.description" rows="3"></textarea>
        </div>
        
        <div class="form-group">
          <label for="category">Category:</label>
          <select id="category" v-model="formData.category">
            <option v-for="(label, value) in categoryOptions" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        
        <div class="form-group">
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
        
        <div class="form-group">
          <label>Tags:</label>
          <div class="tags-input">
            <div v-for="(tag, index) in formData.tags" :key="index" class="tag">
              {{ tag }}
              <span class="remove-tag" @click="removeTag(index)">✕</span>
            </div>
            <input 
              type="text" 
              v-model="newTag" 
              @keydown.enter.prevent="addTag" 
              @keydown.tab.prevent="addTag"
              placeholder="Add tag and press Enter">
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

// Dynamic category options
const categoryOptions = ref({});

// Fetch available categories from the database
async function fetchCategories() {
  try {
    const allLocations = await api.getCategories();
    const categories = {};
    
    // Extract unique categories and create options map
    allLocations.forEach(cat => {
      const type = cat.toLowerCase();
      // Format the display name (capitalize first letter of each word)
      const displayName = type
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      categories[type] = displayName;
    });
    
    // Add "other" as a fallback category if not already present
    if (!categories['other']) {
      categories['other'] = 'Other';
    }
    
    categoryOptions.value = categories;
  } catch (error) {
    console.error('Failed to load categories:', error);
    // Fallback to default categories
    categoryOptions.value = {
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

onMounted(() => {
  fetchCategories();
});

const props = defineProps({
  location: {
    type: Object,
    default: () => ({
      id: null,
      name: '',
      description: '',
      type: 'poi',
      coordinates: ['[0, 0]']
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

// Ensure we have valid data with defaults for missing properties
const ensureValidLocation = (loc) => {
  // Normalize the category/type
  let category = (loc.type || loc.category || 'poi').toLowerCase();
  
  return {
    id: loc.id || null,
    name: loc.name || '',
    description: loc.description || '',
    category: category,
    coordinates: normalizeCoordinates(loc.coordinates),
    tags: extractTagsFromDescription(loc.description)
  };
};

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

// Add tags back to description when saving
function addTagsToDescription(description, tags) {
  if (!tags || tags.length === 0) return description || '';
  
  let desc = description || '';
  
  // Check if description already ends with tags
  const tagRegex = /#\w+(\s+#\w+)*\s*$/;
  if (tagRegex.test(desc)) {
    // Remove existing tags at the end
    desc = desc.replace(tagRegex, '').trim();
  }
  
  // Add tags at the end
  if (desc && !desc.endsWith(' ')) {
    desc += ' ';
  }
  
  // Add each tag with # prefix
  desc += tags.map(tag => `#${tag}`).join(' ');
  
  return desc;
}

// Form data with validated location
const safeLocation = ensureValidLocation(props.location);
const formData = ref({
  id: safeLocation.id,
  name: safeLocation.name,
  description: safeLocation.description,
  category: safeLocation.category,
  coordinates: safeLocation.coordinates,
  tags: safeLocation.tags
});

// Handling coordinates
const coordinateErrors = ref(Array(formData.value.coordinates.length).fill(null));
const showBulkParser = ref(false);
const bulkCoordinates = ref('');

// Handling tags
const newTag = ref('');

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
    category: validLocation.category,
    coordinates: validLocation.coordinates,
    tags: validLocation.tags
  };
  coordinateErrors.value = Array(formData.value.coordinates.length).fill(null);
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

// Tag functions
function addTag() {
  const tag = newTag.value.trim();
  if (tag && !formData.value.tags.includes(tag)) {
    formData.value.tags.push(tag);
    newTag.value = '';
  }
}

function removeTag(index) {
  formData.value.tags.splice(index, 1);
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
  
  // Map category back to type to match schema
  saveData.type = saveData.category;
  delete saveData.category;
  
  // Convert string coordinates to array format for database
  saveData.coordinates = prepareCoordinatesForSaving(saveData.coordinates);
  
  // Store tags in description for now
  saveData.description = addTagsToDescription(saveData.description, saveData.tags);
  delete saveData.tags; // Remove tags as it's not in the schema
  
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
  max-width: 600px;
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

.form-group {
  margin-bottom: 16px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

input[type="text"],
textarea,
select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
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

.tags-input {
  display: flex;
  flex-wrap: wrap;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  background: #fff;
  min-height: 40px;
  align-items: center;
}

.tag {
  background: #e9ecef;
  border-radius: 16px;
  padding: 4px 8px;
  margin: 4px;
  display: flex;
  align-items: center;
  font-size: 13px;
}

.remove-tag {
  margin-left: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: bold;
}

.tags-input input {
  flex: 1;
  border: none;
  outline: none;
  padding: 6px;
  min-width: 120px;
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
</style>
