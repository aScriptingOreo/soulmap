/**
 * Notification service for displaying messages to the user
 */

/**
 * Show a notification to the user
 * 
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (success, error, warning, info)
 * @param {number} duration - How long to display the notification in milliseconds
 */
export function showNotification(message, type = 'success', duration = 3000) {
  // Dispatch a custom event that the notification component will listen for
  const event = new CustomEvent('show-notification', {
    detail: { message, type, duration }
  });
  
  window.dispatchEvent(event);
}

export default {
  showNotification
};
