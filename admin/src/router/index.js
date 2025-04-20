import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from '../views/Dashboard.vue';
import Login from '../views/Login.vue';
import AuthCallback from '../views/AuthCallback.vue';
import { useAuthStore } from '../stores/authStore';

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: Dashboard,
    meta: { requiresAuth: true }
  },
  {
    path: '/locations',
    name: 'locations',
    component: () => import('../views/Locations.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/requests',
    name: 'requests',
    component: () => import('../views/Requests.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: { guest: true }
  },
  // Add a route for /login/ (with trailing slash) to match Discord's redirect URI
  {
    path: '/login/',
    component: Login,
    meta: { guest: true }
  },
  {
    path: '/auth/callback',
    name: 'auth-callback',
    component: AuthCallback,
    props: route => ({
      hash: route.hash,
      query: route.query
    })
  }
];

const router = createRouter({
  // Ensure history base matches Vite's base path
  history: createWebHistory('/admin/'),
  routes
});

// Navigation guard to check authentication
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  const isGuestRoute = to.matched.some(record => record.meta.guest);
  
  // Check if authenticated and token is still valid
  if (authStore.isAuthenticated && !authStore.isLoading) {
    if (!authStore.hasRequiredRoles) {
      // If user doesn't have required roles, log them out
      authStore.error = 'Access denied. Insufficient permissions.';
      authStore.logout();
      return next('/login');
    }
    
    if (isGuestRoute) {
      // If user is logged in and trying to access a guest route
      return next('/');
    }
  } else if (requiresAuth) {
    // If route requires authentication but user is not logged in
    return next('/login');
  }
  
  next();
});

export default router;
