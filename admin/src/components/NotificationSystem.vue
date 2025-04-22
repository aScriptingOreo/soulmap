<template>
  <div class="notification-container">
    <transition-group name="notification-fade">
      <div 
        v-for="notification in notifications" 
        :key="notification.id"
        :class="['notification', notification.type]"
      >
        <div class="notification-icon">
          <i :class="getIconForType(notification.type)"></i>
        </div>
        <div class="notification-content">
          <div class="notification-message">{{ notification.message }}</div>
        </div>
        <button class="notification-close" @click="removeNotification(notification.id)">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

// Store for notifications
const notifications = ref([]);
let nextId = 1;

// Function to get appropriate icon based on notification type
function getIconForType(type) {
  switch (type) {
    case 'success':
      return 'fa-solid fa-check-circle';
    case 'error':
      return 'fa-solid fa-exclamation-circle';
    case 'warning':
      return 'fa-solid fa-exclamation-triangle';
    case 'info':
    default:
      return 'fa-solid fa-info-circle';
  }
}

// Function to add a notification
function showNotification(message, type = 'success', duration = 3000) {
  const id = nextId++;
  
  // Create the notification
  const notification = {
    id,
    message,
    type
  };

  // Add to the list
  notifications.value.push(notification);
  
  // Auto-remove after the specified duration
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(id);
    }, duration);
  }
  
  return id;
}

// Function to remove a specific notification
function removeNotification(id) {
  const index = notifications.value.findIndex(notification => notification.id === id);
  if (index !== -1) {
    notifications.value.splice(index, 1);
  }
}

// Create an event bus for notifications
const notificationBus = new Map();

// Listen for notification events
function setupEventListeners() {
  window.addEventListener('show-notification', (e) => {
    const { message, type, duration } = e.detail;
    showNotification(message, type, duration);
  });
}

// Clean up event listeners
onMounted(setupEventListeners);
onUnmounted(() => {
  window.removeEventListener('show-notification', setupEventListeners);
});

// Expose functions to parent components
defineExpose({
  showNotification,
  removeNotification
});
</script>

<style scoped>
.notification-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 320px;
  max-width: 100%;
  pointer-events: none; /* Allow clicks to pass through the container */
}

.notification {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  padding: 12px;
  pointer-events: auto; /* Make notifications themselves clickable */
  overflow: hidden;
  position: relative;
  border-left: 4px solid transparent;
}

.notification.success {
  border-left-color: #4caf50;
}

.notification.error {
  border-left-color: #f44336;
}

.notification.warning {
  border-left-color: #ff9800;
}

.notification.info {
  border-left-color: #2196f3;
}

.notification-icon {
  margin-right: 12px;
  min-width: 24px;
  display: flex;
  justify-content: center;
}

.notification.success .notification-icon {
  color: #4caf50;
}

.notification.error .notification-icon {
  color: #f44336;
}

.notification.warning .notification-icon {
  color: #ff9800;
}

.notification.info .notification-icon {
  color: #2196f3;
}

.notification-content {
  flex: 1;
}

.notification-message {
  line-height: 1.5;
}

.notification-close {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: #666;
  padding: 2px;
  margin-left: 8px;
}

/* Animation for notifications */
.notification-fade-enter-active,
.notification-fade-leave-active {
  transition: all 0.3s ease;
}

.notification-fade-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.notification-fade-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
