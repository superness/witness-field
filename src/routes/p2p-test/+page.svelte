<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { witnesses, addWitness, reWitness, initializeStore, connectionStatus } from '../../lib/witnessStore-p2p.js';
  import type { Witness } from '../../lib/types.js';

  let testWitnessText = '';
  let connectionLog: string[] = [];
  let isConnecting = false;

  // Connection status tracking
  $: {
    if ($connectionStatus) {
      const timestamp = new Date().toLocaleTimeString();
      const status = `[${timestamp}] Mode: ${$connectionStatus.mode}, WebRTC: ${$connectionStatus.webrtcConnections}, Relay: ${$connectionStatus.relayConnected ? 'Yes' : 'No'}`;
      connectionLog = [status, ...connectionLog.slice(0, 19)]; // Keep last 20 entries
    }
  }

  onMount(() => {
    console.log('🧪 Starting P2P test page');
    initializeStore();
    isConnecting = true;
    
    // Give connections time to establish
    setTimeout(() => {
      isConnecting = false;
    }, 10000);
  });

  const handleAddTestWitness = async () => {
    if (!testWitnessText.trim()) return;
    
    const witness = await addWitness(testWitnessText);
    if (witness) {
      testWitnessText = '';
      console.log('✅ Test witness created:', witness.id);
    }
  };

  const handleReWitness = async (witnessId: string) => {
    const success = await reWitness(witnessId);
    console.log(success ? '✅ Re-witnessed' : '❌ Re-witness failed', witnessId);
  };

  const createStressTestWitnesses = async () => {
    for (let i = 0; i < 5; i++) {
      await addWitness(`Stress test witness #${i + 1} - ${Date.now()}`);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    }
  };

  const getConnectionModeColor = (mode: string) => {
    switch (mode) {
      case 'p2p': return 'text-green-600';
      case 'relay': return 'text-yellow-600';
      default: return 'text-red-600';
    }
  };

  const getConnectionModeText = (mode: string) => {
    switch (mode) {
      case 'p2p': return '🌐 True P2P (WebRTC)';
      case 'relay': return '📡 Relay Fallback';
      default: return '❌ Offline';
    }
  };
</script>

<svelte:head>
  <title>P2P Test - Witness Field</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-6">
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">🌐 True P2P Test Suite</h1>
      <p class="text-gray-600">Testing WebRTC direct connections with Gun.js peer discovery</p>
    </div>

    <!-- Connection Status -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">📡 Connection Status</h2>
        
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Mode:</span>
            <span class="{getConnectionModeColor($connectionStatus.mode)} font-semibold">
              {getConnectionModeText($connectionStatus.mode)}
            </span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">WebRTC Connections:</span>
            <span class="font-semibold text-blue-600">{$connectionStatus.webrtcConnections}</span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Discovered Peers:</span>
            <span class="font-semibold text-purple-600">{$connectionStatus.peerCount}</span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Relay Available:</span>
            <span class="font-semibold {$connectionStatus.relayConnected ? 'text-green-600' : 'text-red-600'}">
              {$connectionStatus.relayConnected ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        {#if isConnecting}
          <div class="mt-4 text-sm text-yellow-600">
            🔄 Discovering peers and establishing connections...
          </div>
        {/if}
      </div>

      <!-- Witness Stats -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">📊 Witness Statistics</h2>
        
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Total Witnesses:</span>
            <span class="font-semibold text-blue-600">{$witnesses.length}</span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Active Witnesses:</span>
            <span class="font-semibold text-green-600">
              {$witnesses.filter(w => w.expiresAt > Date.now()).length}
            </span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Total Re-witnesses:</span>
            <span class="font-semibold text-purple-600">
              {$witnesses.reduce((sum, w) => sum + w.witnessCount, 0)}
            </span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-gray-700">Contextualized:</span>
            <span class="font-semibold text-orange-600">
              {$witnesses.filter(w => w.contextOf).length}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Test Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">🧪 Test Controls</h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Create Test Witness</label>
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={testWitnessText}
              placeholder="Enter test witness text..."
              class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              on:keypress={(e) => e.key === 'Enter' && handleAddTestWitness()}
            />
            <button
              on:click={handleAddTestWitness}
              disabled={!testWitnessText.trim()}
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
        
        <div class="flex items-end">
          <button
            on:click={createStressTestWitnesses}
            class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            🔥 Create 5 Test Witnesses
          </button>
        </div>
      </div>
    </div>

    <!-- Connection Log -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">📜 Connection Log</h2>
      <div class="bg-gray-900 text-green-400 p-4 rounded-md h-48 overflow-y-auto font-mono text-sm">
        {#each connectionLog as logEntry}
          <div>{logEntry}</div>
        {/each}
        {#if connectionLog.length === 0}
          <div class="text-gray-500">Waiting for connection events...</div>
        {/if}
      </div>
    </div>

    <!-- Witness List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-semibold mb-4">👁️ Active Witnesses</h2>
      
      {#if $witnesses.length === 0}
        <div class="text-center text-gray-500 py-8">
          <p class="text-lg">No witnesses yet</p>
          <p class="text-sm">Create a test witness above to get started</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-4 max-h-96 overflow-y-auto">
          {#each $witnesses as witness (witness.id)}
            <div class="border border-gray-200 rounded-lg p-4">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <p class="text-gray-900 mb-2">{witness.text}</p>
                  <div class="flex items-center gap-4 text-sm text-gray-600">
                    <span>Count: {witness.witnessCount}</span>
                    <span>ID: {witness.id.slice(-8)}</span>
                    <span>Expires: {Math.ceil((witness.expiresAt - Date.now()) / 1000)}s</span>
                    {#if witness.contextOf}
                      <span class="text-blue-600">Context: {witness.contextOf.slice(-8)}</span>
                    {/if}
                  </div>
                </div>
                <button
                  on:click={() => handleReWitness(witness.id)}
                  class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                >
                  👁️ Re-witness
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Instructions -->
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
      <h3 class="text-lg font-semibold text-blue-900 mb-2">🧪 Testing Instructions</h3>
      <div class="text-blue-800 space-y-2 text-sm">
        <p><strong>1. Open this page in multiple browser tabs/windows</strong> to test local connections</p>
        <p><strong>2. Open on different devices</strong> on the same network to test cross-device P2P</p>
        <p><strong>3. Create witnesses and observe:</strong></p>
        <ul class="list-disc list-inside ml-4 space-y-1">
          <li>Connection mode should show "True P2P (WebRTC)" when peers connect</li>
          <li>Witnesses should appear instantly across all connected peers</li>
          <li>Re-witnessing should sync count increases immediately</li>
          <li>If no WebRTC connections, falls back to relay mode</li>
        </ul>
        <p><strong>4. Check browser console</strong> for detailed P2P connection logs</p>
      </div>
    </div>
  </div>
</div>

<style>
  /* Custom scrollbar for better UX */
  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-track {
    background: #f1f5f9;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 3px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
</style>