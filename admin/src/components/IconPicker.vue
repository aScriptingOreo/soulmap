<template>
  <div class="icon-picker-container">
    <label>Icon:</label>
    
    <!-- Add a custom input option -->
    <div class="icon-input-container">
      <div class="selected-icon-preview" @click="togglePicker">
        <span v-if="!modelValue" class="placeholder">Select Icon</span>
        <template v-else>
          <img 
            v-if="modelValue && modelValue.startsWith('/')" 
            :src="getSvgUrl(modelValue)" 
            :alt="modelValue" 
            class="preview-icon svg-icon"
            @error="onIconError"
          >
          <i 
            v-else-if="modelValue"
            :class="modelValue"
            class="preview-icon fa-icon"
            aria-hidden="true"
          ></i>
          <span class="icon-text">{{ modelValue }}</span>
        </template>
        <button type="button" class="toggle-btn">{{ showPicker ? 'Hide' : 'Choose' }}</button>
      </div>
      
      <!-- Add custom icon input field -->
      <div class="custom-icon-input">
        <input 
          type="text" 
          v-model="customIconInput" 
          placeholder="Enter custom icon e.g., fa-solid fa-star" 
          @input="handleCustomIconInput"
          @keydown.enter="applyCustomIcon"
        >
        <button type="button" @click="applyCustomIcon" class="apply-btn">Apply</button>
      </div>
    </div>

    <div v-if="showPicker" class="picker-dropdown">
      <input 
        type="text" 
        v-model="searchTerm" 
        placeholder="Search icons..." 
        class="search-input"
      >
      <div v-if="loadingError" class="error-message">
        {{ loadingError }}
      </div>
      <div v-else class="icon-grid">
        <div 
          v-for="icon in filteredIcons" 
          :key="icon" 
          class="icon-item" 
          :class="{ selected: modelValue === icon }"
          @click="selectIcon(icon)"
          :title="icon"
        >
          <img 
            v-if="icon && icon.startsWith('/')" 
            :src="getSvgUrl(icon)" 
            :alt="icon" 
            class="grid-icon svg-icon" 
            @error="onIconError"
          >
          <i 
            v-else-if="icon"
            :class="icon"
            class="grid-icon fa-icon"
            aria-hidden="true"
          ></i>
        </div>
        
        <div v-if="!filteredIcons || filteredIcons.length === 0" class="no-results"> 
          No icons found matching your search or available.
        </div>
      </div>
      <button type="button" @click="selectIcon(null)" class="clear-btn">Clear Selection</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { extractIconsFromLocations } from '../services/api';
import { discoverFontAwesomeIcons } from '../utils/fontAwesomeIcons';

const props = defineProps({
  modelValue: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['update:modelValue']);

const showPicker = ref(false);
const searchTerm = ref('');
const allAvailableIcons = ref([]);
const loadingError = ref(null);
let eventSource = null;

// Add custom icon input functionality
const customIconInput = ref('');

// Initialize with current value if any
onMounted(() => {
  if (props.modelValue) {
    customIconInput.value = props.modelValue;
  }
  
  fetchAvailableIcons();
  setupSSEListener();
});

// Handle custom icon input
function handleCustomIconInput() {
  // Allow user to type any value - we'll format it when they apply
}

// Apply the custom icon
function applyCustomIcon() {
  if (!customIconInput.value.trim()) return;
  
  let iconValue = customIconInput.value.trim();
  
  // If user only entered the icon name without prefix, add the fa-solid prefix
  if (!iconValue.includes(' ') && !iconValue.startsWith('fa-') && !iconValue.startsWith('/')) {
    iconValue = `fa-solid fa-${iconValue}`;
  }
  // If user entered something like "star" or "fa-star", add the proper prefix
  else if (!iconValue.includes(' ') && iconValue.startsWith('fa-')) {
    iconValue = `fa-solid ${iconValue}`;
  }
  // If user entered "fas fa-something" format, convert to new format
  else if (iconValue.startsWith('fas fa-')) {
    iconValue = iconValue.replace('fas fa-', 'fa-solid fa-');
  }
  else if (iconValue.startsWith('far fa-')) {
    iconValue = iconValue.replace('far fa-', 'fa-regular fa-');
  }
  else if (iconValue.startsWith('fab fa-')) {
    iconValue = iconValue.replace('fab fa-', 'fa-brands fa-');
  }
  
  // Update the model value
  emit('update:modelValue', iconValue);
  
  // Add this custom icon to our available icons if it's not already there
  if (!allAvailableIcons.value.includes(iconValue) && 
      (iconValue.startsWith('fa-solid') || iconValue.startsWith('fa-regular') || iconValue.startsWith('fa-brands'))) {
    allAvailableIcons.value.push(iconValue);
    allAvailableIcons.value.sort();
  }
}

// Watch for changes to the model value
watch(() => props.modelValue, (newValue) => {
  if (newValue) {
    customIconInput.value = newValue;
  } else {
    customIconInput.value = '';
  }
});

// Load icons directly and from locations
async function fetchAvailableIcons() {
  loadingError.value = null;
  try {
    // First, get common Font Awesome icons
    const fontAwesomeIcons = discoverFontAwesomeIcons();
    
    // Then try to get icons from locations
    try {
      const locationsIcons = await extractIconsFromLocations();
      
      // Combine both sets of icons, ensuring unified format
      const combinedIcons = new Set();
      
      // Add all icons with proper format
      const addIcon = (icon) => {
        if (!icon) return;
        
        // Standardize format for Font Awesome icons
        if (icon.startsWith('fas fa-')) {
          // Convert old "fas fa-xyz" format to "fa-solid fa-xyz"
          const iconName = icon.substring(7); // Remove "fas fa-"
          combinedIcons.add(`fa-solid fa-${iconName}`);
        } else if (icon.startsWith('far fa-')) {
          // Convert old "far fa-xyz" format to "fa-regular fa-xyz"
          const iconName = icon.substring(7); // Remove "far fa-"
          combinedIcons.add(`fa-regular fa-${iconName}`);
        } else {
          // Keep other formats as is (SVGs or already in correct format)
          combinedIcons.add(icon);
        }
      };
      
      // Add all icons from both sources
      fontAwesomeIcons.forEach(addIcon);
      locationsIcons.forEach(addIcon);
      
      // Convert to array and sort
      allAvailableIcons.value = Array.from(combinedIcons).sort();
      console.log(`Found ${allAvailableIcons.value.length} icons in total (standardized format)`);
    } catch (err) {
      // If locations fetch fails, still use Font Awesome icons
      allAvailableIcons.value = fontAwesomeIcons;
      console.log(`Using ${allAvailableIcons.value.length} Font Awesome icons`);
    }
  } catch (error) {
    console.error("Error loading icons:", error);
    loadingError.value = "Could not load available icons.";
    
    // Fallback to basic Font Awesome icons with correct format
    allAvailableIcons.value = [
      'fa-solid fa-map-marker-alt',
      'fa-solid fa-home',
      'fa-solid fa-tree',
      'fa-solid fa-mountain',
      'fa-solid fa-store'
    ];
  }
}

// Setup SSE listener - keep this but modify the event handling
function setupSSEListener() {
  try {
    // Use relative URL for SSE endpoint
    const sseUrl = '/api/listen'; 
    eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Listen for generic location changes as a trigger to refresh icons
        if (message.type === 'change') { 
            console.log('SSE: Location change detected, refreshing icons...');
            fetchAvailableIcons(); 
        } else if (message.type === 'connected') {
            console.log('SSE: Connected to icon updates.');
        }
      } catch (error) {
        console.error('SSE: Error parsing message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE: Connection error:', error);
      if (eventSource) {
        eventSource.close();
      }
    };
  } catch (error) {
    console.error('Failed to initialize SSE:', error);
  }
}

// Fetch icons and setup listener on mount
onMounted(() => {
  fetchAvailableIcons();
  setupSSEListener();
});

// Clean up SSE connection on unmount
onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    console.log('SSE: Connection closed.');
  }
});

// Filter icons based on search term
const filteredIcons = computed(() => {
  if (!searchTerm.value.trim()) {
    return allAvailableIcons.value;
  }
  
  const lowerSearch = searchTerm.value.toLowerCase();
  const sourceIcons = Array.isArray(allAvailableIcons.value) ? allAvailableIcons.value : [];

  // Group by type for more organized search results
  const groupedResults = {
    exact: [],
    solid: [],
    regular: [],
    brands: [],
    svg: []
  };
  
  sourceIcons.forEach(icon => {
    if (!icon) return;
    
    const iconLower = icon.toLowerCase();
    
    // Check for exact matches first
    if (iconLower === lowerSearch) {
      groupedResults.exact.push(icon);
      return;
    }
    
    // Font Awesome solid icons (with correct format)
    if (icon.startsWith('fa-solid fa-')) {
      // Extract the icon name without the prefix
      const iconName = icon.substring('fa-solid fa-'.length).toLowerCase();
      if (iconName && iconName.includes(lowerSearch)) {
        groupedResults.solid.push(icon);
        return;
      }
    }
    
    // Font Awesome regular icons
    if (icon.startsWith('fa-regular fa-')) {
      const iconName = icon.substring('fa-regular fa-'.length).toLowerCase();
      if (iconName && iconName.includes(lowerSearch)) {
        groupedResults.regular.push(icon);
        return;
      }
    }
    
    // Font Awesome brands icons
    if (icon.startsWith('fa-brands fa-')) {
      const iconName = icon.substring('fa-brands fa-'.length).toLowerCase();
      if (iconName && iconName.includes(lowerSearch)) {
        groupedResults.brands.push(icon);
        return;
      }
    }
    
    // SVG icons
    if (icon.startsWith('/')) {
      if (iconLower.includes(lowerSearch)) {
        groupedResults.svg.push(icon);
      }
    }
  });
  
  // Concatenate all groups in priority order
  return [
    ...groupedResults.exact,
    ...groupedResults.solid,
    ...groupedResults.regular,
    ...groupedResults.brands,
    ...groupedResults.svg
  ];
});

// For SVG icons
function getSvgUrl(iconPath) {
  if (!iconPath || !iconPath.startsWith('/')) return '';
  return `https://soulmap.avakot.org${iconPath}.svg?v=3`;
}

function togglePicker() {
  showPicker.value = !showPicker.value;
}

function selectIcon(icon) {
  emit('update:modelValue', icon);
  customIconInput.value = icon || '';
  showPicker.value = false;
}

function onIconError(event) {
  console.warn('Failed to load icon preview/grid item:', event.target.src);
  event.target.style.display = 'none';
}
</script>

<style scoped>
.icon-picker-container {
  margin-bottom: 16px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.selected-icon-preview {
  display: flex;
  align-items: center;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  min-height: 38px; /* Match input height */
  background-color: #fff;
  position: relative; /* For button positioning */
}

.selected-icon-preview:hover {
  border-color: #bbb;
}

.placeholder {
  color: #888;
  flex-grow: 1;
}

.preview-icon {
  width: 24px;
  height: 24px;
  margin-right: 8px;
  vertical-align: middle;
  object-fit: contain; /* For SVGs */
}
.fa-icon {
  text-align: center;
  font-size: 20px; /* Adjust as needed */
}

.icon-text {
  flex-grow: 1;
  font-family: monospace;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-btn {
  background: #f8f9fa;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  margin-left: auto; /* Push to the right */
}

.picker-dropdown {
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-top: 4px;
  padding: 10px;
  background-color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-height: 300px;
  overflow-y: auto;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 10px;
  box-sizing: border-box;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 8px;
}

.icon-item {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #eee;
  border-radius: 4px;
  padding: 5px;
  cursor: pointer;
  height: 40px; /* Fixed height */
  transition: background-color 0.2s ease;
}

.icon-item:hover {
  background-color: #f0f0f0;
  border-color: #ddd;
}

.icon-item.selected {
  background-color: #e0efff;
  border-color: #99caff;
}

.grid-icon {
  max-width: 28px;
  max-height: 28px;
  object-fit: contain;
}
.grid-icon.fa-icon {
   font-size: 22px;
   width: 1em; /* Ensure consistent width for FA icons */
}

.no-results {
  grid-column: 1 / -1; /* Span all columns */
  text-align: center;
  color: #888;
  padding: 10px;
}

.clear-btn {
  margin-top: 10px;
  background: #f8f9fa;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}
.clear-btn:hover {
  background: #e9ecef;
}

/* Ensure grid icons handle missing images gracefully */
.grid-icon {
  display: inline-block; /* Helps if image fails to load */
}
.preview-icon.fa-icon,
.grid-icon.fa-icon {
  display: inline-block; /* Or block if needed */
  text-align: center;
  /* font-size is already set, width might help alignment */
  width: 1.25em; 
}

.error-message {
  color: #e74c3c;
  padding: 10px;
  text-align: center;
  background-color: #fdd;
  border: 1px solid #e74c3c;
  border-radius: 4px;
  margin-bottom: 10px;
}

.icon-input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-icon-input {
  display: flex;
  gap: 8px;
}

.custom-icon-input input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.apply-btn {
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
}

.apply-btn:hover {
  background: #45a049;
}
</style>
