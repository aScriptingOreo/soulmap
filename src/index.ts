// src/index.ts
import { marked } from 'marked';
import { loadLocations } from './loader';
import { initializeMap } from './map';

async function loadGreeting() {
  try {
    const response = await fetch('./greetings.md');
    const markdown = await response.text();
    const html = marked(markdown);
    
    const popupText = document.getElementById('popup-text');
    if (popupText) {
      popupText.innerHTML = html;
      document.getElementById('popup-overlay')!.style.display = 'flex';
    }
  } catch (error) {
    console.error('Error loading greeting:', error);
  }
}

function dismissPopup() {
  document.getElementById('popup-overlay')!.style.display = 'none';
  // Initialize map after dismissing popup
  initMain();
}

async function initMain() {
  const urlParams = new URLSearchParams(window.location.search);
  const debug = urlParams.get('debug') === 'true';
  const locations = await loadLocations();
  if (locations.length > 0) {
    initializeMap(locations, debug);
  } else {
    console.error("No locations loaded. Map initialization aborted.");
  }
}

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', async () => {
  // Show greeting first
  await loadGreeting();
  
  // Set up dismiss handler
  document.querySelector('#popup-content button')?.addEventListener('click', dismissPopup);
});