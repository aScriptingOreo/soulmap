<template>
  <div class="dashboard">    
    <div class="grafana-container">
      <iframe 
        src="https://grafana.7thseraph.org/public-dashboards/fcd64b0f7bfb4c5e953212bf7dee28c6?orgId=1&refresh=1m" 
        width="100%" 
        height="1200"  
        frameborder="0"
        title="Soulmap Grafana Stats"
      ></iframe>
    </div>
  </div>
</template>

<script setup>
// No script logic needed anymore
</script>

<style scoped>
.dashboard {
  padding: 20px;
}

.grafana-container {
  margin-top: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden; /* Ensures iframe respects border radius */
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  /* Adjust height as needed or make it responsive */
  height: 1200px; 
}

iframe {
  display: block; /* Removes potential bottom space */
  width: 100%;
  height: 100%;
}
</style>