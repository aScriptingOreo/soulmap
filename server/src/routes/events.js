import express from 'express';

const router = express.Router();
console.log('Events router file loaded.');

// Store connected SSE clients
const clients = [];

// Get client list (for other modules that need access)
export function getClients() {
  return clients;
}

// Helper to broadcast to all clients
export function broadcastToAll(data) {
  const jsonData = typeof data === 'string' ? data : JSON.stringify(data);
  
  // Skip broadcasting if no clients are connected
  if (clients.length === 0) {
    return;
  }
  
  // Track clients that failed to receive the message
  const failedClients = [];
  
  clients.forEach((client, index) => {
    try {
      client.res.write(`data: ${jsonData}\n\n`);
    } catch (error) {
      console.warn(`Error broadcasting to client ${client.id}:`, error.message);
      failedClients.push(index);
    }
  });
  
  // Remove failed clients (in reverse order to avoid index shifting issues)
  failedClients.reverse().forEach(index => {
    const client = clients[index];
    console.log(`Removing failed client ${client.id} from clients list`);
    clients.splice(index, 1);
  });
}

// SSE endpoint
router.get('/', (req, res) => {
  // Set up SSE connection
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to SSE stream' })}\n\n`);
  
  // Generate client ID
  const clientId = Date.now().toString();
  
  // Store client connection
  clients.push({ id: clientId, res });
  console.log(`Client ${clientId} connected to SSE, total clients: ${clients.length}`);
  
  // Set up heartbeat to prevent connection timeout
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
    } catch (error) {
      // If we can't write to the response, clean up
      console.warn(`Heartbeat failed for client ${clientId}:`, error.message);
      clearInterval(heartbeatInterval);
      const index = clients.findIndex(client => client.id === clientId);
      if (index !== -1) {
        clients.splice(index, 1);
      }
    }
  }, 30000);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    const index = clients.findIndex(client => client.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
      console.log(`Client ${clientId} disconnected, remaining clients: ${clients.length}`);
    }
  });
});

// Polling endpoint for clients that don't support SSE
router.get('/poll', (req, res) => {
  res.json({
    updated: false,
    timestamp: Date.now()
  });
});

export default router;
