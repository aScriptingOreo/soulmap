<template>
  <div class="auth-callback">
    <div class="loading">
      <p>Processing authentication, please wait...</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/authStore';

const router = useRouter();
const authStore = useAuthStore();

onMounted(async () => {
  console.log("Auth callback mounted, hash:", window.location.hash);
  
  // Check for access token in URL fragment
  if (window.location.hash && window.location.hash.includes('access_token')) {
    try {
      const success = await authStore.handleOAuthCallback(window.location.hash);
      if (success && authStore.hasRequiredRoles) {
        router.push('/');
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error("Authentication error:", error);
      authStore.error = "Authentication failed: " + error.message;
      router.push('/login');
    }
  } else {
    console.error("No access token found in URL");
    authStore.error = "No access token found in the callback URL";
    router.push('/login');
  }
});
</script>

<style scoped>
.auth-callback {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.loading {
  text-align: center;
  padding: 20px;
}
</style>
