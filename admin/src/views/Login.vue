<template>
  <div class="login-container">
    <div class="login-card">
      <h1>Soulmap Admin</h1>
      <p class="description">Administrator dashboard for Soulmap location data</p>
      
      <div v-if="authStore.isLoading" class="loading">
        <p>Authenticating...</p>
      </div>
      
      <div v-else-if="authStore.error" class="error">
        <p>{{ authStore.error }}</p>
        <button class="btn btn-primary" @click="retry">Try Again</button>
      </div>
      
      <div v-else>
        <a :href="discordOAuthUrl" class="discord-button">
          <svg class="discord-icon" viewBox="0 -28.5 256 256" version="1.1" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid">
            <path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z" fill="#FFFFFF" fill-rule="nonzero"></path>
          </svg>
          <span>Login with Discord</span>
        </a>
      </div>
      
      <div class="footer">
        <p>&copy; {{ new Date().getFullYear() }} Soulmap Team</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/authStore';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

// Discord OAuth configuration
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
// Ensure the redirect URI correctly includes /admin/login/ with trailing slash
const REDIRECT_URI = encodeURIComponent(`${window.location.origin}/admin/login/`);
// Keep the scope as is
const SCOPE = encodeURIComponent('identify guilds');

// Log the configuration for debugging
console.log('OAuth Configuration:');
console.log('Client ID:', DISCORD_CLIENT_ID);
console.log('Redirect URI:', decodeURIComponent(REDIRECT_URI));
console.log('Full OAuth URL:', `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=token&scope=${SCOPE}`);

const discordOAuthUrl = computed(() => 
  `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=token&scope=${SCOPE}`
);

// Handle OAuth callback if we have a URL fragment (for implicit flow)
onMounted(async () => {
  // Handling hash fragment for implicit flow (token comes in the URL fragment)
  if (route.hash) {
    console.log("Processing OAuth callback with hash:", route.hash);
    const success = await authStore.handleOAuthCallback(route.hash);
    if (success && authStore.hasRequiredRoles) {
      router.push('/');
    }
  } else if (authStore.isAuthenticated) {
    // Validate existing token on page load
    const isValid = await authStore.validateToken(authStore.token);
    if (isValid && authStore.hasRequiredRoles) {
      router.push('/');
    }
  }
});

function retry() {
  authStore.error = null;
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  /* Removed background-color: #2c3e50; */ 
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 450px; 
  background: white;
  border-radius: 8px;
  padding: 40px; 
  /* Adjusted existing shadow and added a subtle border for better definition */
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); 
  border: 1px solid #eee; /* Optional: Add a light border */
  text-align: center;
}

h1 {
  margin-bottom: 10px;
  color: #2c3e50;
  font-size: 2rem; /* Adjusted font size */
  font-weight: 600; /* Adjusted font weight */
}

.description {
  color: #7f8c8d;
  margin-bottom: 30px;
  font-size: 1rem; /* Adjusted font size */
}

.discord-button {
  display: inline-flex; /* Changed to inline-flex for better centering with auto margin */
  align-items: center;
  justify-content: center;
  background-color: #5865F2;
  color: white;
  padding: 12px 24px;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.2s;
  margin: 30px auto; /* Increased top/bottom margin */
  width: auto; /* Let the button size itself */
  min-width: 200px; /* Added min-width */
  border: none; /* Ensure no border */
  cursor: pointer; /* Add cursor pointer */
}

.discord-button:hover {
  background-color: #4752c4;
}

.discord-icon {
  width: 24px;
  height: 24px;
  margin-right: 10px;
}

.footer {
  margin-top: 40px;
  font-size: 0.9rem; /* Adjusted font size */
  color: #95a5a6;
}

.error {
  color: #e74c3c;
  background-color: #fdeded;
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.loading {
  padding: 20px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
}

.btn-primary {
  background-color: #3498db;
  color: white;
}

.btn-primary:hover {
  background-color: #2980b9;
}
</style>
