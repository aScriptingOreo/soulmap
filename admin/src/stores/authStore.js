import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref(localStorage.getItem('discord_token') || null);
  const user = ref(JSON.parse(localStorage.getItem('discord_user') || 'null'));
  const isLoading = ref(false);
  const error = ref(null);
  
  // Role IDs
  const ADMIN_ROLE_ID = '1309700533749289012';
  const MANAGER_ROLE_ID = '1363588579506262056';
  
  // Computed
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  
  const hasRequiredRoles = computed(() => {
    if (!user.value || !user.value.roles) return false;
    
    // Check if user has either Admin or Manager role
    const requiredRoleIds = [ADMIN_ROLE_ID, MANAGER_ROLE_ID];
    return user.value.roles.some(role => requiredRoleIds.includes(role));
  });
  
  const isAdmin = computed(() => {
    return user.value?.roles?.includes(ADMIN_ROLE_ID) || false;
  });
  
  const isManager = computed(() => {
    return user.value?.roles?.includes(MANAGER_ROLE_ID) || false;
  });
  
  // Actions
  async function validateToken(discordToken) {
    if (!discordToken) return false;
    
    try {
      isLoading.value = true;
      error.value = null;
      
      const response = await fetch('/api/admin/auth/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: discordToken }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to validate token');
      }
      
      const data = await response.json();
      
      if (data.valid) {
        // Store the validated user information
        user.value = data.user;
        token.value = discordToken;
        
        // Save to local storage
        localStorage.setItem('discord_token', discordToken);
        localStorage.setItem('discord_user', JSON.stringify(data.user));
        
        return true;
      } else {
        throw new Error(data.message || 'Token validation failed');
      }
    } catch (err) {
      console.error('Auth validation error:', err);
      error.value = err.message;
      return false;
    } finally {
      isLoading.value = false;
    }
  }
  
  function handleOAuthCallback(hash) {
    if (!hash) return false;
    
    // Parse the access token from URL fragment
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    
    if (accessToken) {
      // Store the token temporarily
      token.value = accessToken;
      
      // Validate the token to get user info and verify roles
      return validateToken(accessToken);
    }
    
    return false;
  }
  
  function logout() {
    // Clear authentication data
    token.value = null;
    user.value = null;
    
    // Remove from local storage
    localStorage.removeItem('discord_token');
    localStorage.removeItem('discord_user');
  }
  
  return {
    token,
    user,
    isLoading,
    error,
    isAuthenticated,
    hasRequiredRoles,
    isAdmin,
    isManager,
    validateToken,
    handleOAuthCallback,
    logout
  };
});
