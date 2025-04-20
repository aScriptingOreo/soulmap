<template>
  <div class="dashboard">
    <h2>Dashboard</h2>
    
    <div v-if="loading" class="loading">
      Loading stats...
    </div>
    
    <div v-else-if="error" class="error">
      {{ error }}
    </div>
    
    <div v-else class="stats-grid">
      <div class="stat-card">
        <h3>Total Locations</h3>
        <p class="stat-value">{{ stats.totalLocations }}</p>
      </div>
      <div class="stat-card">
        <h3>Pending Requests</h3>
        <p class="stat-value">{{ stats.pendingRequests }}</p>
      </div>
      <div class="stat-card">
        <h3>Recent Updates</h3>
        <p class="stat-value">{{ stats.recentUpdates }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getStats } from '../services/api';

const stats = ref({
  totalLocations: 0,
  pendingRequests: 0,
  recentUpdates: 0
});
const loading = ref(true);
const error = ref(null);

onMounted(async () => {
  try {
    const data = await getStats();
    stats.value = data;
  } catch (err) {
    error.value = `Error loading stats: ${err.message}`;
    console.error(err);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dashboard {
  padding: 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.stat-card {
  background-color: #f5f5f5;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stat-value {
  font-size: 2em;
  font-weight: bold;
  color: #4285f4;
}

.loading, .error {
  padding: 20px;
  text-align: center;
  margin: 40px 0;
}

.error {
  color: #ea4335;
  background-color: #fdeded;
  border-radius: 8px;
  padding: 15px;
}
</style>
