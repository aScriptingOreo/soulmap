<template>
  <div class="requests">
    <h2>Requests Management</h2>
    
    <div class="filters">
      <label>
        Status:
        <select v-model="statusFilter">
          <option value="all">All Requests</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>
      
      <label>
        Type:
        <select v-model="typeFilter">
          <option value="all">All Types</option>
          <option value="new">New Location</option>
          <option value="edit">Edit Location</option>
          <option value="delete">Delete Location</option>
        </select>
      </label>
    </div>
    
    <div v-if="loading" class="loading">
      Loading requests...
    </div>
    
    <div v-else-if="error" class="error">
      {{ error }}
    </div>
    
    <template v-else>
      <table v-if="filteredRequests.length">
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Location</th>
            <th>Status</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in filteredRequests" :key="request.id">
            <td>{{ request.id }}</td>
            <td>{{ request.request_type || 'Unknown' }}</td>
            <td>{{ request.markerName || request.marker_id || 'N/A' }}</td>
            <td>
              <span :class="`status status-${request.status}`">
                {{ request.status }}
              </span>
            </td>
            <td>{{ formatDate(request.createdAt) }}</td>
            <td>
              <button class="btn btn-sm">View</button>
              <button 
                v-if="request.status === 'pending'" 
                class="btn btn-sm btn-success"
                @click="approveRequest(request.id)"
              >Approve</button>
              <button 
                v-if="request.status === 'pending'" 
                class="btn btn-sm btn-danger"
                @click="rejectRequest(request.id)"
              >Reject</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>No requests found matching the selected filters.</p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getRequests, updateRequestStatus } from '../services/api';

const requests = ref([]);
const loading = ref(true);
const error = ref(null);
const statusFilter = ref('all');
const typeFilter = ref('all');

onMounted(async () => {
  await loadRequests();
});

async function loadRequests() {
  try {
    loading.value = true;
    const data = await getRequests();
    requests.value = data;
  } catch (err) {
    error.value = `Error loading requests: ${err.message}`;
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function approveRequest(id) {
  try {
    await updateRequestStatus(id, 'approved');
    // Reload the requests
    await loadRequests();
  } catch (err) {
    alert(`Error approving request: ${err.message}`);
  }
}

async function rejectRequest(id) {
  const reason = prompt('Please provide a reason for rejecting this request:');
  if (reason === null) return; // User cancelled
  
  try {
    await updateRequestStatus(id, 'rejected', reason);
    // Reload the requests
    await loadRequests();
  } catch (err) {
    alert(`Error rejecting request: ${err.message}`);
  }
}

const filteredRequests = computed(() => {
  return requests.value.filter(req => {
    const statusMatch = statusFilter.value === 'all' || req.status === statusFilter.value;
    const typeMatch = typeFilter.value === 'all' || 
                     (req.request_type && req.request_type.toLowerCase() === typeFilter.value);
    return statusMatch && typeMatch;
  });
});

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
</script>

<style scoped>
.requests {
  padding: 20px;
}

.filters {
  margin: 20px 0;
  display: flex;
  gap: 20px;
}

select {
  padding: 6px;
  margin-left: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
}

th, td {
  text-align: left;
  padding: 12px;
  border-bottom: 1px solid #ddd;
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 5px;
}

.btn-sm {
  padding: 4px 8px;
}

.btn-success {
  background-color: #34a853;
  color: white;
}

.btn-danger {
  background-color: #ea4335;
  color: white;
}

.status {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: bold;
}

.status-pending {
  background-color: #fbbc05;
  color: #333;
}

.status-approved {
  background-color: #34a853;
  color: white;
}

.status-denied {
  background-color: #ea4335;
  color: white;
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
