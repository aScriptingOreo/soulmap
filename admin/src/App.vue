<template>
  <div class="app">
    <header v-if="authStore.isAuthenticated" class="app-header">
      <h1>Soulmap Admin</h1>
      <nav class="main-nav">
        <router-link to="/" class="nav-button" active-class="active" exact>Dashboard</router-link>
        <router-link to="/locations" class="nav-button" active-class="active">Locations</router-link>
        <!-- <router-link to="/requests" class="nav-button" active-class="active">Requests</router-link> -->
        <router-link to="/map" class="nav-button" active-class="active">Live Map</router-link> 
      </nav>
      <div class="header-actions">
        <div class="user-info" :style="userInfoStyle">
          <i class="fa-brands fa-discord discord-icon"></i>
          <span>{{ authStore.user?.username }}</span>
        </div>
        <a href="#" @click.prevent="logout" class="logout-icon-button" title="Logout">
          <i class="fa-solid fa-right-from-bracket"></i>
        </a>
      </div>
    </header>
    
    <main>
      <router-view />
    </main>
    
    <footer v-if="authStore.isAuthenticated">
      <p>Soulmap Admin Panel &copy; {{ new Date().getFullYear() }}</p>
    </footer>

    <!-- Add the notification system component -->
    <NotificationSystem />
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/authStore';
import { computed } from 'vue';
import NotificationSystem from './components/NotificationSystem.vue';

const authStore = useAuthStore();
const router = useRouter();

// Define Role IDs
const ADMIN_ROLE_ID = '1309700533749289012';
const MANAGER_ROLE_ID = '1363588579506262056';

// Define Role Colors
const ADMIN_COLOR = '#c27c0e'; // Gold/Yellowish
const MANAGER_COLOR = '#5865f2'; // Discord Blue
const DEFAULT_COLOR = '#7289da'; // Discord Blurple (Default)

// Computed style for user info background
const userInfoStyle = computed(() => {
  const roles = authStore.user?.roles || [];
  let backgroundColor = DEFAULT_COLOR;

  if (roles.includes(ADMIN_ROLE_ID)) {
    backgroundColor = ADMIN_COLOR;
  } else if (roles.includes(MANAGER_ROLE_ID)) {
    backgroundColor = MANAGER_COLOR;
  }
  
  return { backgroundColor };
});

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.app {
  font-family: Arial, sans-serif;
  /* Removed max-width from here to allow header to be controlled independently */
  margin: 0 auto;
  padding: 20px;
}

.app-header {
  margin-bottom: 20px;
  display: flex;
  align-items: center; /* Align items vertically */
  flex-wrap: wrap; /* Allow wrapping on smaller screens */
  gap: 15px; /* Add gap between elements */
  max-width: 1100px; /* Limit header width */
  margin-left: auto;  /* Center the header */
  margin-right: auto; /* Center the header */
  padding-left: 15px; /* Add some padding if needed */
  padding-right: 15px; /* Add some padding if needed */
}

.app-header h1 {
  margin: 0; /* Remove default margin */
  margin-right: auto; /* Push nav and actions to the right */
}

.main-nav {
  margin: 0; /* Remove default margin */
  display: flex;
  gap: 10px;
  /* Remove border and padding */
  /* border-bottom: 1px solid #eaeaea; */
  /* padding-bottom: 10px; */
  order: 1; /* Ensure nav comes after title on wrap */
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 15px; /* Space between user info and logout */
  order: 2; /* Ensure actions come last */
  margin-left: auto; /* Push actions to the far right */
}

.nav-button {
  padding: 8px 16px;
  border-radius: 4px;
  background-color: #f5f5f5;
  color: #333;
  text-decoration: none;
  font-weight: 500;
  border: 1px solid #ddd;
  transition: all 0.2s ease;
}

.nav-button:hover {
  background-color: #e9e9e9;
  border-color: #ccc;
}

.nav-button.active {
  background-color: #4285f4;
  color: white;
  border-color: #3367d6;
}

/* Remove old text logout button styles if they exist */
/* .logout-button { ... } */

.user-info {
  display: flex;
  align-items: center;
  /* background-color: #5865f2; Remove static background color */
  color: white;
  padding: 6px 12px;
  border-radius: 16px; /* Rounded corners */
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  transition: background-color 0.3s ease; /* Add transition for color change */
}

.discord-icon {
  margin-right: 8px;
  font-size: 1.3em; /* Increased icon size */
}

.logout-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px; /* Adjust size as needed */
  height: 36px; /* Adjust size as needed */
  border-radius: 50%; /* Make it circular */
  background-color: #f1f1f1; /* Light grey background */
  color: #d32f2f; /* Red icon color */
  text-decoration: none;
  font-size: 18px; /* Increased icon size */
  border: 1px solid #ddd;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

.logout-icon-button:hover {
  background-color: #e9e9e9;
  border-color: #ccc;
  color: #b71c1c; /* Darker red on hover */
  box-shadow: 0 2px 4px rgba(0,0,0,0.15);
}

footer {
  margin-top: 40px;
  border-top: 1px solid #eee;
  padding-top: 10px;
  font-size: 0.8em;
  color: #666;
}

main {
  min-height: 400px;
  /* Ensure main content area can grow */
  flex-grow: 1; 
  display: flex;
  flex-direction: column;
}

/* Ensure router-view container takes available space if needed */
main > div { /* Assuming router-view renders into a div */
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

/* Responsive adjustments if needed */
@media (max-width: 768px) {
  .app-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .app-header h1 {
    margin-right: 0;
    margin-bottom: 10px;
  }
  .main-nav {
    width: 100%;
    justify-content: flex-start;
    border-bottom: 1px solid #eaeaea;
    padding-bottom: 10px;
    order: 2;
  }
  .header-actions {
    width: 100%;
    justify-content: flex-end; /* Align actions to the right */
    margin-left: 0;
    margin-top: 10px;
    order: 1;
    gap: 10px; /* Adjust gap for smaller screens if needed */
  }
}
</style>
