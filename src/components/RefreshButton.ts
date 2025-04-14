export function initializeRefreshButton(): void {
  // Create refresh button element
  const refreshButton = document.createElement('button');
  refreshButton.id = 'map-refresh-button';
  refreshButton.title = 'Refresh Map Data (Alt+R)';
  refreshButton.innerHTML = '<i class="fa-solid fa-rotate"></i>';
  refreshButton.className = 'map-control-button';
  
  // Style the button
  refreshButton.style.cssText = `
    position: absolute;
    top: 80px;
    right: 10px;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  `;
  
  // Add hover effect
  refreshButton.addEventListener('mouseenter', () => {
    refreshButton.style.background = 'rgba(0, 0, 0, 0.8)';
  });
  
  refreshButton.addEventListener('mouseleave', () => {
    refreshButton.style.background = 'rgba(0, 0, 0, 0.6)';
  });
  
  // Add click handler
  refreshButton.addEventListener('click', async () => {
    // Show loading animation
    const icon = refreshButton.querySelector('i');
    if (icon) {
      icon.className = 'fa-solid fa-spin fa-spinner';
      refreshButton.disabled = true;
    }
    
    // Call the global refresh function
    try {
      // Clear relevant caches
      await clearLocationsCache();
      await clearTileCache(); // Assuming you have this function

      // Optionally, trigger a data reload or page refresh
      // Example: Reload the page
      window.location.reload();

      // Or, if using a state management system, dispatch an action
      // store.dispatch({ type: 'REFRESH_DATA' });

    } catch (error) {
      // Optionally show an error message to the user
      if (icon) {
        icon.className = 'fa-solid fa-exclamation';
        setTimeout(() => {
          icon.className = 'fa-solid fa-rotate';
          refreshButton.disabled = false;
        }, 1000);
      }
    }
  });
  
  // Add to document
  document.body.appendChild(refreshButton);
}
