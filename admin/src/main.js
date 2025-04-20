import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

// Create vue app
const app = createApp(App);

// Use plugins
app.use(createPinia());
app.use(router);

// Mount app
app.mount('#app');

// Log base URL for debugging
console.log('Admin application initialized with base URL:', import.meta.env.BASE_URL);
console.log('Current URL:', window.location.href);
