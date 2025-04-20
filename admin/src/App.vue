<template>
  <div class="app">
    <header v-if="authStore.isAuthenticated">
      <h1>SoulMap Admin</h1>
      <nav>
        <router-link to="/">Dashboard</router-link> |
        <router-link to="/locations">Locations</router-link> |
        <router-link to="/requests">Requests</router-link> |
        <a href="#" @click.prevent="logout">Logout</a>
      </nav>
      <div class="user-info">
        <span>{{ authStore.user?.username }}</span>
      </div>
    </header>
    
    <main>
      <router-view />
    </main>
    
    <footer v-if="authStore.isAuthenticated">
      <p>SoulMap Admin Panel &copy; {{ new Date().getFullYear() }}</p>
    </footer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/authStore';

const authStore = useAuthStore();
const router = useRouter();

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.app {
  font-family: Arial, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

header {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
}

nav {
  margin: 10px 0;
}

nav a {
  margin-right: 10px;
  text-decoration: none;
}

.user-info {
  margin-left: auto;
  display: flex;
  align-items: center;
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
}
</style>
