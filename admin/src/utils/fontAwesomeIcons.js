/**
 * Utility functions for working with Font Awesome icons
 */

// Common Font Awesome icon names used in the application with correct format "fa-solid fa-icon"
const commonFaIcons = [
  // Map-related icons
  'fa-solid fa-map-marker-alt',
  'fa-solid fa-map-pin',
  'fa-solid fa-map-signs',
  'fa-solid fa-map',
  'fa-solid fa-compass',
  
  // Location types
  'fa-solid fa-home',
  'fa-solid fa-tree',
  'fa-solid fa-mountain',
  'fa-solid fa-dungeon',
  'fa-solid fa-skull',
  'fa-solid fa-store',
  'fa-solid fa-flag',
  'fa-solid fa-city',
  'fa-solid fa-campground',
  'fa-solid fa-fish',
  'fa-solid fa-water',
  'fa-solid fa-hands-helping',
  'fa-solid fa-gem',
  'fa-solid fa-shield-alt',
  'fa-solid fa-scroll',
  'fa-solid fa-landmark',
  'fa-solid fa-dragon',
  'fa-solid fa-coins',
  'fa-solid fa-chess-rook',
  'fa-solid fa-hat-wizard',
  'fa-solid fa-hammer',
  'fa-solid fa-warehouse',
  'fa-solid fa-university',
  'fa-solid fa-archway',
  'fa-solid fa-gopuram',
  'fa-solid fa-church',
  'fa-solid fa-place-of-worship',
  'fa-solid fa-door-open',
  'fa-solid fa-road',
  'fa-solid fa-ghost',
  'fa-solid fa-school'
];

/**
 * Attempt to discover Font Awesome icons from the DOM and standardize their format
 */
export function discoverFontAwesomeIcons() {
  const icons = new Set();
  
  // Add our common set first
  commonFaIcons.forEach(icon => icons.add(icon));
  
  try {
    // Try to scan the DOM for Font Awesome icons
    document.querySelectorAll('[class*="fa-"]').forEach(el => {
      const classes = Array.from(el.classList);
      
      // Look for combinations of FA classes
      const isSolid = classes.includes('fa-solid') || classes.includes('fas');
      const isRegular = classes.includes('fa-regular') || classes.includes('far');
      const isBrands = classes.includes('fa-brands') || classes.includes('fab');
      
      // Find the actual icon class (fa-something)
      const iconClass = classes.find(cls => 
        cls.startsWith('fa-') && 
        !['fa-solid', 'fa-regular', 'fa-brands', 'fa-fw', 'fa-spin', 'fa-pulse'].includes(cls)
      );
      
      if (iconClass) {
        if (isSolid) {
          icons.add(`fa-solid ${iconClass}`);
        } else if (isRegular) {
          icons.add(`fa-regular ${iconClass}`);
        } else if (isBrands) {
          icons.add(`fa-brands ${iconClass}`);
        }
      }
    });
  } catch (e) {
    console.warn('Error scanning DOM for Font Awesome icons:', e);
  }
  
  return Array.from(icons).sort();
}
