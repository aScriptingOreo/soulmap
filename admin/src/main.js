import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

// Import Font Awesome CSS from local directory if needed
import './libs/fontawesome/css/all.min.css'; // Uncomment this if needed

// Create vue app
const app = createApp(App);

// Register a simple Font Awesome icon component
app.component('font-awesome-icon', {
  props: {
    icon: {
      type: [Array, String],
      required: true
    },
    size: String,
    fixedWidth: Boolean,
    color: String
  },
  render() {
    const style = {};
    if (this.color) style.color = this.color;
    
    // Handle Array format (e.g., ['fas', 'coffee'])
    if (Array.isArray(this.icon) && this.icon.length >= 2) {
      const prefix = this.icon[0]; // 'fas', 'far', etc.
      const name = this.icon[1];   // 'coffee', 'user', etc.
      
      // Convert to the new format (fa-solid, fa-regular)
      let standardPrefix;
      if (prefix === 'fas') standardPrefix = 'fa-solid';
      else if (prefix === 'far') standardPrefix = 'fa-regular';
      else if (prefix === 'fab') standardPrefix = 'fa-brands';
      else standardPrefix = prefix;
      
      const classes = [
        standardPrefix, 
        `fa-${name}`,
        this.size ? `fa-${this.size}` : '',
        this.fixedWidth ? 'fa-fw' : ''
      ].filter(Boolean); // Remove empty strings
      
      return h('i', { class: classes, style });
    } 
    // Handle string format (e.g., "fas fa-coffee" or "fa-solid fa-coffee")
    else if (typeof this.icon === 'string') {
      // For backward compatibility, convert old format to new if needed
      let iconClasses;
      if (this.icon.startsWith('fas ')) {
        // Convert old format "fas fa-xyz" to "fa-solid fa-xyz"
        const iconName = this.icon.substring(4); // Remove "fas "
        iconClasses = `fa-solid ${iconName}`;
      } else if (this.icon.startsWith('far ')) {
        // Convert old format "far fa-xyz" to "fa-regular fa-xyz"
        const iconName = this.icon.substring(4); // Remove "far "
        iconClasses = `fa-regular ${iconName}`;
      } else {
        // Use as is if already in new format or other format
        iconClasses = this.icon;
      }
      
      return h('i', { 
        class: [
          iconClasses,
          this.size ? `fa-${this.size}` : '',
          this.fixedWidth ? 'fa-fw' : ''
        ], 
        style 
      });
    }
    
    return null;
  }
});

// Use plugins
app.use(createPinia());
app.use(router);

// Mount app
app.mount('#app');

// Log base URL for debugging
console.log('Admin application initialized with base URL:', import.meta.env.BASE_URL);
console.log('Current URL:', window.location.href);
