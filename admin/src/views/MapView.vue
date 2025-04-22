<template>
  <div class="map-view-container">
    <div class="iframe-wrapper">
      <iframe 
        src="https://soulmap.avakot.org" 
        width="100%" 
        height="100%" 
        frameborder="0"
        title="Soulmap Live Preview"
        allowfullscreen
      ></iframe>
    </div>
  </div>
</template>

<script setup>
// No specific script logic needed for this simple view
</script>

<style scoped>
.map-view-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 160px); /* Adjust based on header/footer height */
  padding: 20px 0; /* Remove horizontal padding to allow full width */
}

h2 {
  margin-bottom: 15px;
  padding: 0 20px; /* Add padding back for the title */
}

.iframe-wrapper {
  flex-grow: 1; /* Allow iframe to take remaining height */
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden; /* Ensures iframe respects border radius */
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

iframe {
  display: block; /* Removes potential bottom space */
  width: 100%;
  height: 100%;
}
</style>
