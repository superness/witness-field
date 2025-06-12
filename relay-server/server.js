const Gun = require('gun');
const http = require('http');
const port = process.env.PORT || 8765;

// Create HTTP server
const server = http.createServer((req, res) => {
  // Basic health check endpoint
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gun.js relay server is running\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Attach Gun.js to the server
const gun = Gun({ 
  web: server,
  peers: [], // No upstream peers - this is a standalone relay
  localStorage: false, // Relay doesn't need localStorage
  radisk: false // Relay doesn't need radisk
});

// Start server
server.listen(port, () => {
  console.log(`🚀 Gun.js relay server running on port ${port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${port}/gun`);
  console.log(`🌐 HTTP health check: http://localhost:${port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});