<script>
  import { onMount } from 'svelte';
  import Gun from 'gun';
  
  let gun;
  let testNode;
  let deviceId = Math.random().toString(36).substr(2, 8);
  let messages = [];
  let testMessage = '';
  let connectionStatus = 'disconnected';
  let connectedPeers = [];
  
  // Test configuration
  const TEST_NAMESPACE = 'sync-test-simple-v1';
  
  function addLog(type, message, data = null) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const logEntry = {
      timestamp,
      type,
      message,
      data,
      deviceId
    };
    messages = [logEntry, ...messages.slice(0, 49)]; // Keep last 50 logs
    console.log(`[${timestamp}] [${type}] ${message}`, data || '');
  }
  
  onMount(() => {
    addLog('INIT', `Starting sync test on device: ${deviceId}`);
    
    // Initialize Gun with same config as main app
    gun = Gun({
      peers: [
        'https://the-witness-field-production.up.railway.app/gun',
        'wss://the-witness-field-production.up.railway.app/gun'
      ],
      localStorage: false, // Disable to force network sync
      radisk: false,
      retry: 1,
      timeout: 5000
    });
    
    addLog('GUN', 'Gun initialized with relay peers');
    
    // Track connection events
    gun.on('hi', (peer) => {
      if (peer && peer.url) {
        addLog('CONNECT', `Connected to peer: ${peer.url}`, peer);
        connectedPeers = [...connectedPeers, peer.url];
        connectionStatus = 'connected';
      } else {
        addLog('CONNECT', 'Gun localStorage ready');
        connectionStatus = 'ready';
      }
    });
    
    gun.on('bye', (peer) => {
      if (peer && peer.url) {
        addLog('DISCONNECT', `Disconnected from peer: ${peer.url}`, peer);
        connectedPeers = connectedPeers.filter(p => p !== peer.url);
        if (connectedPeers.length === 0) {
          connectionStatus = 'disconnected';
        }
      } else {
        addLog('DISCONNECT', 'Gun peer connection lost');
        connectionStatus = 'disconnected';
      }
    });
    
    // Set up test namespace
    testNode = gun.get(TEST_NAMESPACE);
    addLog('NAMESPACE', `Connected to test namespace: ${TEST_NAMESPACE}`);
    
    // Listen for ALL data changes in real-time
    testNode.map().on((data, key) => {
      if (!data) return;
      
      addLog('RECEIVE', `Real-time data received`, { key, data });
      
      // Skip our own messages to avoid echo
      if (data.deviceId === deviceId) {
        addLog('SKIP', 'Skipping own message');
        return;
      }
      
      addLog('SYNC', `Message from ${data.deviceId}: ${data.message}`);
    });
    
    // Load existing data
    testNode.map().once((data, key) => {
      if (!data) return;
      addLog('LOAD', `Loaded existing data`, { key, data });
    });
    
    addLog('READY', 'Sync test ready - start sending messages');
  });
  
  function sendTestMessage() {
    if (!testMessage.trim() || !testNode) return;
    
    const messageData = {
      message: testMessage.trim(),
      deviceId: deviceId,
      timestamp: Date.now(),
      id: Math.random().toString(36).substr(2, 9)
    };
    
    addLog('SEND', `Sending message: ${messageData.message}`, messageData);
    
    // Store in Gun
    testNode.get(messageData.id).put(messageData);
    
    testMessage = '';
  }
  
  function clearLogs() {
    messages = [];
    addLog('CLEAR', 'Logs cleared');
  }
  
  function copyLogs() {
    const logText = messages.map(m => 
      `[${m.timestamp}] [${m.type}] ${m.message} ${m.data ? JSON.stringify(m.data) : ''}`
    ).join('\n');
    
    navigator.clipboard.writeText(logText).then(() => {
      addLog('COPY', 'Logs copied to clipboard');
    });
  }
</script>

<svelte:head>
  <title>Sync Test - Witness Field</title>
</svelte:head>

<main class="container mx-auto p-4 max-w-4xl">
  <div class="bg-white rounded-lg shadow-lg p-6">
    <h1 class="text-2xl font-bold mb-4">Cross-Device Sync Test</h1>
    
    <!-- Device Info -->
    <div class="bg-gray-100 p-4 rounded mb-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <strong>Device ID:</strong> {deviceId}
        </div>
        <div class="flex items-center">
          <div class="w-3 h-3 rounded-full mr-2 {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'ready' ? 'bg-yellow-500' : 'bg-red-500'}"></div>
          <strong>Status:</strong> {connectionStatus}
        </div>
        <div>
          <strong>Peers:</strong> {connectedPeers.length}
        </div>
      </div>
    </div>
    
    <!-- Test Instructions -->
    <div class="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
      <h2 class="font-semibold mb-2">Test Instructions:</h2>
      <ol class="list-decimal list-inside space-y-1 text-sm">
        <li>Open this page on multiple devices/browsers</li>
        <li>Wait for "connected" status on all devices</li>
        <li>Send a message from one device</li>
        <li>Check if it appears in real-time on other devices</li>
        <li>Copy logs to compare between devices</li>
      </ol>
    </div>
    
    <!-- Send Message -->
    <div class="mb-6">
      <div class="flex gap-2">
        <input 
          bind:value={testMessage}
          on:keydown={(e) => e.key === 'Enter' && sendTestMessage()}
          placeholder="Type a test message..."
          class="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button 
          on:click={sendTestMessage}
          disabled={!testMessage.trim()}
          class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
        >
          Send
        </button>
      </div>
    </div>
    
    <!-- Log Controls -->
    <div class="flex gap-2 mb-4">
      <button 
        on:click={clearLogs}
        class="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
      >
        Clear Logs
      </button>
      <button 
        on:click={copyLogs}
        class="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
      >
        Copy Logs
      </button>
      <span class="text-sm text-gray-500 flex items-center">
        {messages.length} log entries
      </span>
    </div>
    
    <!-- Real-time Logs -->
    <div class="bg-black text-green-400 font-mono text-xs p-4 rounded h-96 overflow-y-auto">
      {#each messages as log}
        <div class="mb-1">
          <span class="text-gray-400">[{log.timestamp}]</span>
          <span class="text-yellow-400">[{log.type}]</span>
          <span class="text-white">{log.message}</span>
          {#if log.data}
            <span class="text-blue-400">{JSON.stringify(log.data)}</span>
          {/if}
        </div>
      {/each}
      
      {#if messages.length === 0}
        <div class="text-gray-500">Logs will appear here...</div>
      {/if}
    </div>
  </div>
</main>

<style>
  :global(body) {
    background-color: #f3f4f6;
  }
</style>