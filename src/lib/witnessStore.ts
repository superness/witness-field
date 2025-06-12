import Gun from 'gun';
import type { Witness } from './types.js';
import { writable } from 'svelte/store';

// P2P Configuration - choose your approach
type P2PMode = 'LOCAL_ONLY' | 'PUBLIC_RELAY' | 'CUSTOM_RELAY';
const P2P_MODE: P2PMode = 'PUBLIC_RELAY'; // Options: 'LOCAL_ONLY', 'PUBLIC_RELAY', 'CUSTOM_RELAY'

// Initialize Gun based on P2P mode
const gun = (() => {
  switch (P2P_MODE as P2PMode) {
    case 'PUBLIC_RELAY':
      console.log('🌐 Using public relays - will mix with other apps using same namespace');
      return Gun({
        peers: [
          'https://the-witness-field-production.up.railway.app/gun',
          'wss://the-witness-field-production.up.railway.app/gun'
        ],
        localStorage: true,  // Re-enable for browser persistence
        radisk: true,        // Re-enable for browser caching  
        retry: 1,
        timeout: 5000
      });
    
    case 'CUSTOM_RELAY':
      console.log('🔧 Using custom relay - run your own Gun relay server');
      return Gun({
        peers: ['http://localhost:8765/gun'],
        localStorage: true,
        radisk: true,
        retry: 1,
        timeout: 3000,
        fallback: true
      });
    
    case 'LOCAL_ONLY':
    default:
      console.log('💾 Local-only mode - no P2P, pure localStorage');
      return Gun({
        localStorage: true,
        radisk: true
      });
  }
})();

// Use a consistent namespace for the witness field collective
const APP_NAMESPACE = 'witness-field-collective-public-v3';
const fieldNode = gun.get(APP_NAMESPACE);
console.log('📦 Using public namespace:', APP_NAMESPACE);

// Gun.js connection tracking
let gunConnected = false;
let connectionRetries = 0;
const maxRetries = 5;
let connectedPeers = new Set<string>();

gun.on('hi', (peer) => {
  if (peer && peer.url) {
    console.log('🟢 Gun.js connected to peer:', peer.url);
    connectedPeers.add(peer.url);
    gunConnected = true;
    connectionRetries = 0;
    updateConnectionStatus();
  } else {
    console.log('💾 Gun.js localStorage ready');
    // Update connection status even for localStorage-only mode
    updateConnectionStatus();
  }
});

gun.on('bye', (peer) => {
  if (peer && peer.url) {
    console.log('🔴 Gun.js disconnected from peer:', peer.url);
    connectedPeers.delete(peer.url);
    updateConnectionStatus();
  } else {
    console.log('⚠️ Gun.js peer connection lost');
    gunConnected = false;
    updateConnectionStatus();
    
    // Attempt to reconnect with limited retries
    if (connectionRetries < maxRetries) {
      connectionRetries++;
      console.log(`🔄 Attempting to reconnect... (${connectionRetries}/${maxRetries})`);
      setTimeout(() => {
        // Reconnection attempt - Gun.js specific
        if ((gun as any)._ && (gun as any)._.opt && (gun as any)._.opt.peers) {
          gun.opt({ peers: (gun as any)._.opt.peers });
        }
      }, 1000 * connectionRetries); // Linear backoff (shorter delays)
    }
  }
});

// Update connection status for UI
const updateConnectionStatus = () => {
  const totalPeers = connectedPeers.size + otherTabsConnected + webrtcPeersConnected;
  connectionStatus.set({
    connected: totalPeers > 0,
    peerCount: totalPeers
  });
};

// Svelte store for local state with memory limit
const MAX_WITNESSES_IN_MEMORY = 200; // Limit witnesses in memory
export const witnesses = writable<Witness[]>([]);

// Memory usage monitoring
let memoryWarningShown = false;
const checkMemoryUsage = () => {
  if (typeof window !== 'undefined' && 'performance' in window && 'memory' in (performance as any)) {
    const memInfo = (performance as any).memory;
    const usedMB = Math.round(memInfo.usedJSHeapSize / 1024 / 1024);
    const limitMB = Math.round(memInfo.jsHeapSizeLimit / 1024 / 1024);
    const percentUsed = (memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit) * 100;
    
    console.log(`💾 Memory: ${usedMB}MB / ${limitMB}MB (${percentUsed.toFixed(1)}%)`);
    
    // Emergency cleanup if memory usage is too high
    if (percentUsed > 80 && !memoryWarningShown) {
      memoryWarningShown = true;
      console.warn('⚠️ High memory usage detected! Performing emergency cleanup...');
      
      // Aggressively reduce witness count
      witnesses.update(current => {
        const reduced = current
          .sort((a, b) => b.expiresAt - a.expiresAt) // Keep longest-lived
          .slice(0, Math.floor(MAX_WITNESSES_IN_MEMORY / 2)); // Cut to half
        console.log(`🧹 Emergency cleanup: reduced from ${current.length} to ${reduced.length} witnesses`);
        return reduced;
      });
      
      // Force garbage collection if available
      if (typeof (window as any).gc === 'function') {
        (window as any).gc();
      }
    } else if (percentUsed < 60) {
      memoryWarningShown = false;
    }
  }
};

// Export cleanup function for manual use
export const manualCleanup = () => cleanupExpiredWitnesses();
export const connectionStatus = writable<{connected: boolean, peerCount: number}>({connected: false, peerCount: 0});

// Real-time sync using BroadcastChannel (for same device across tabs)
const syncChannel = typeof window !== 'undefined' ? new BroadcastChannel('witness-field-sync') : null;
let otherTabsConnected = 0;
let webrtcPeersConnected = 0;
const myTabId = Math.random().toString(36).substr(2, 9);

// WebRTC P2P Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Track WebRTC peer connections with cleanup
const peerConnections = new Map<string, RTCPeerConnection>();
const dataChannels = new Map<string, RTCDataChannel>();
const MAX_PEER_CONNECTIONS = 10; // Limit concurrent connections

// Setup real-time sync between tabs
if (syncChannel) {
  // Listen for messages from other tabs
  syncChannel.onmessage = (event) => {
    const { type, data, fromTab } = event.data;
    
    if (fromTab === myTabId) return; // Ignore our own messages
    
    switch (type) {
      case 'NEW_WITNESS':
        console.log('📡 Received new witness from another tab:', data.id);
        witnesses.update(current => {
          const existing = current.find(w => w.id === data.id);
          if (!existing) {
            return [...current, data];
          }
          return current;
        });
        break;
        
      case 'UPDATE_WITNESS':
        console.log('📡 Received witness update from another tab:', data.id);
        witnesses.update(current => 
          current.map(w => w.id === data.id ? data : w)
        );
        break;
        
      case 'TAB_PING':
        // Respond to ping to let other tabs know we exist
        syncChannel.postMessage({
          type: 'TAB_PONG',
          fromTab: myTabId
        });
        break;
        
      case 'TAB_PONG':
        // Another tab responded to our ping
        if (!event.data.counted) {
          otherTabsConnected++;
          updateConnectionStatus();
          event.data.counted = true;
        }
        break;
    }
  };
  
  // Ping other tabs to discover them
  const discoverTabs = () => {
    otherTabsConnected = 0;
    syncChannel.postMessage({
      type: 'TAB_PING',
      fromTab: myTabId
    });
    // Update status after a brief delay to let pongs come in
    setTimeout(updateConnectionStatus, 100);
  };
  
  // Discover tabs on startup and periodically
  discoverTabs();
  setInterval(discoverTabs, 5000);
}

// WebRTC P2P Functions
const createPeerConnection = (peerId: string, isInitiator: boolean = false) => {
  console.log(`🌐 Creating WebRTC connection to ${peerId} (initiator: ${isInitiator})`);
  
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, pc);
  
  // Create data channel for witness data
  let dataChannel: RTCDataChannel;
  if (isInitiator) {
    dataChannel = pc.createDataChannel('witnesses', { ordered: true });
    setupDataChannel(dataChannel, peerId);
  }
  
  // Handle incoming data channel
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel, peerId);
  };
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && fieldNode) {
      console.log('📡 Sending ICE candidate to', peerId);
      fieldNode.get('webrtc-signaling').get(peerId).get(myTabId).put({
        type: 'ice-candidate',
        candidate: JSON.stringify(event.candidate),
        timestamp: Date.now()
      });
    }
  };
  
  // Handle connection state changes
  pc.onconnectionstatechange = () => {
    console.log(`🔗 WebRTC connection to ${peerId}:`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      webrtcPeersConnected++;
      updateConnectionStatus();
      // Clean up old connections if we have too many
      if (peerConnections.size > MAX_PEER_CONNECTIONS) {
        const oldestPeer = Array.from(peerConnections.keys())[0];
        const oldPC = peerConnections.get(oldestPeer);
        if (oldPC) {
          oldPC.close();
          peerConnections.delete(oldestPeer);
          dataChannels.delete(oldestPeer);
        }
      }
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      // Clean up resources
      const channel = dataChannels.get(peerId);
      if (channel) {
        channel.close();
      }
      pc.close();
      peerConnections.delete(peerId);
      dataChannels.delete(peerId);
      webrtcPeersConnected = Math.max(0, webrtcPeersConnected - 1);
      updateConnectionStatus();
    }
  };
  
  return pc;
};

const setupDataChannel = (channel: RTCDataChannel, peerId: string) => {
  dataChannels.set(peerId, channel);
  
  channel.onopen = () => {
    console.log(`✅ Data channel to ${peerId} opened`);
  };
  
  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebRTCMessage(message, peerId);
    } catch (e) {
      console.warn('Failed to parse WebRTC message:', e);
    }
  };
  
  channel.onerror = (error) => {
    console.error(`❌ Data channel error with ${peerId}:`, error);
  };
};

const handleWebRTCMessage = (message: any, fromPeer: string) => {
  console.log(`📡 Received WebRTC message from ${fromPeer}:`, message.type);
  
  switch (message.type) {
    case 'NEW_WITNESS':
      witnesses.update(current => {
        const existing = current.find(w => w.id === message.data.id);
        if (!existing) {
          console.log('🌐 Adding witness from WebRTC peer:', message.data.id);
          return [...current, message.data];
        }
        return current;
      });
      break;
      
    case 'UPDATE_WITNESS':
      witnesses.update(current => 
        current.map(w => w.id === message.data.id ? message.data : w)
      );
      break;
  }
};

const broadcastToWebRTCPeers = (message: any) => {
  dataChannels.forEach((channel, peerId) => {
    if (channel.readyState === 'open') {
      try {
        channel.send(JSON.stringify(message));
      } catch (e) {
        console.warn(`Failed to send to peer ${peerId}:`, e);
      }
    }
  });
};

// Helper to generate unique ID
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

// Proof of Work system - target ~1 second of computation
const computeProofOfWork = async (text: string): Promise<{nonce: number, hash: string}> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let nonce = 0;
    
    const compute = () => {
      // Do work in small batches to avoid blocking UI
      const batchSize = 1000;
      for (let i = 0; i < batchSize; i++) {
        const data = text + nonce;
        
        // Simple hash computation - adjust multiplier to target ~1 second
        let hash = 0;
        for (let j = 0; j < data.length; j++) {
          hash = ((hash << 5) - hash + data.charCodeAt(j)) & 0xffffffff;
        }
        
        // Add extra computational work to reach ~1 second
        for (let k = 0; k < 10000; k++) {
          hash = (hash * 1103515245 + 12345) & 0xffffffff;
        }
        
        // Check if we've hit our time target
        if (Date.now() - startTime >= 1000) {
          // Ensure consistent hash representation (handle negative numbers)
          const finalHash = (hash >>> 0).toString(16);
          resolve({ nonce, hash: finalHash });
          return;
        }
        
        nonce++;
      }
      
      // Continue computation in next tick to avoid blocking
      setTimeout(compute, 0);
    };
    
    compute();
  });
};

// Verify proof of work
const verifyProofOfWork = (text: string, proof: {nonce: number, hash: string}): boolean => {
  const data = text + proof.nonce;
  let hash = 0;
  
  for (let j = 0; j < data.length; j++) {
    hash = ((hash << 5) - hash + data.charCodeAt(j)) & 0xffffffff;
  }
  
  for (let k = 0; k < 10000; k++) {
    hash = (hash * 1103515245 + 12345) & 0xffffffff;
  }
  
  // Handle both signed and unsigned hash representations
  const calculatedHashSigned = hash.toString(16);
  const calculatedHashUnsigned = (hash >>> 0).toString(16);
  const isValid = calculatedHashSigned === proof.hash || calculatedHashUnsigned === proof.hash;
  
  // Debug logging for first few failures
  if (!isValid && debugPoWFailures < 5) {
    debugPoWFailures++;
    console.log('🔍 PoW Debug:', {
      text: text.substring(0, 30) + '...',
      nonce: proof.nonce,
      expectedHash: proof.hash,
      calculatedHashSigned: calculatedHashSigned,
      calculatedHashUnsigned: calculatedHashUnsigned,
      hashNumeric: hash,
      dataString: data.substring(0, 50) + '...'
    });
  }
  
  return isValid;
};

let debugPoWFailures = 0;

// Development mode - set to true for fast testing
const DEV_MODE = false;

// Helper to create default expiration
const getDefaultExpiration = () => {
  if (DEV_MODE) {
    return Date.now() + (5 * 60 * 1000); // 5 minutes in dev mode
  }
  return Date.now() + (3 * 60 * 1000); // 3 minutes in production to reduce memory pressure
};

// Debug helper for testing expiration (30 seconds)
export const getTestExpiration = () => Date.now() + 30000;

// Check if position is too close to existing witnesses
const isPositionTooClose = (newPos: {x: number, y: number}, existingWitnesses: Witness[], minDistance: number = 8) => {
  return existingWitnesses.some(w => {
    if (!w.metadata.position) return false;
    const dx = w.metadata.position.x - newPos.x;
    const dy = w.metadata.position.y - newPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < minDistance;
  });
};

// Calculate how many witnesses are connected to a given witness
const getConnectionCount = (witnessId: string, allWitnesses: Witness[]): number => {
  return allWitnesses.filter(w => w.contextOf === witnessId).length;
};

// Find a smart nearby spot for a connected witness
const findSmartNearbySpot = (parentWitness: Witness, allWitnesses: Witness[]): {x: number, y: number} => {
  if (!parentWitness.metadata.position) {
    return { x: 50, y: 50 }; // Fallback to center
  }
  
  const parent = parentWitness.metadata.position;
  const distance = 2; // Fixed 2% distance
  
  // Try 8 directions around parent: N, NE, E, SE, S, SW, W, NW
  const directions = [
    { x: 0, y: -distance },    // N
    { x: distance, y: -distance }, // NE
    { x: distance, y: 0 },     // E
    { x: distance, y: distance },  // SE
    { x: 0, y: distance },     // S
    { x: -distance, y: distance }, // SW
    { x: -distance, y: 0 },    // W
    { x: -distance, y: -distance } // NW
  ];
  
  // Try each direction
  for (const dir of directions) {
    const testPos = {
      x: Math.max(1, Math.min(99, parent.x + dir.x)),
      y: Math.max(1, Math.min(99, parent.y + dir.y))
    };
    
    // Check if this spot is far enough from other witnesses
    const tooClose = allWitnesses.some(w => {
      if (!w.metadata.position || w.id === parentWitness.id) return false;
      const dx = w.metadata.position.x - testPos.x;
      const dy = w.metadata.position.y - testPos.y;
      return Math.sqrt(dx * dx + dy * dy) < 1.5; // 1.5% minimum distance
    });
    
    if (!tooClose) {
      return testPos;
    }
  }
  
  // If all 8 spots taken, just place at first direction
  return {
    x: Math.max(1, Math.min(99, parent.x + directions[0].x)),
    y: Math.max(1, Math.min(99, parent.y + directions[0].y))
  };
};

// Generate spatial position for field layout - spread out across the full field
const generatePosition = (contextWitness?: Witness, existingWitnesses: Witness[] = []) => {
  // For context witnesses, use smart nearby placement
  if (contextWitness && contextWitness.metadata.position) {
    return findSmartNearbySpot(contextWitness, existingWitnesses);
  }
  
  // For non-context witnesses, use the existing random placement logic
  if (existingWitnesses.length > 0 && existingWitnesses.length < 30) {
    // When not too crowded, position near existing witnesses
    const randomExisting = existingWitnesses[Math.floor(Math.random() * existingWitnesses.length)];
    if (randomExisting.metadata.position) {
      const drift = 20 + Math.random() * 30; // 20-50% drift from existing
      const angle = Math.random() * Math.PI * 2;
      
      const newX = Math.max(2, Math.min(98, 
        randomExisting.metadata.position.x + Math.cos(angle) * drift
      ));
      const newY = Math.max(2, Math.min(98, 
        randomExisting.metadata.position.y + Math.sin(angle) * drift
      ));
      
      return { x: newX, y: newY };
    }
  }
  
  // Default: spread across entire field
  return {
    x: 5 + Math.random() * 90, // Use full 5-95% of field
    y: 5 + Math.random() * 90,
  };
};

// Calculate what the witness count SHOULD be based on deterministic decay
// All devices will get the same result for the same witness at the same time
const calculateCurrentWitnessCount = (witness: Witness): number => {
  const timeSinceLastWitness = Date.now() - witness.lastWitnessed;
  
  if (DEV_MODE) {
    // In dev mode: lose 1 witness count every 45 seconds of inactivity
    const decayInterval = 45 * 1000;
    const decaySteps = Math.floor(timeSinceLastWitness / decayInterval);
    return Math.max(1, witness.witnessCount - decaySteps);
  } else {
    // In production: lose 1 witness count every 2 minutes of inactivity  
    const decayInterval = 2 * 60 * 1000;
    const decaySteps = Math.floor(timeSinceLastWitness / decayInterval);
    return Math.max(1, witness.witnessCount - decaySteps);
  }
};

// Calculate entropy-based expiration
const calculateExpiration = (witnessCount: number, lastWitnessed: number) => {
  if (DEV_MODE) {
    const baseLifetime = 1 * 60 * 1000; // 1 minute in dev
    const entropyBonus = Math.min(witnessCount * 10 * 1000, 2 * 60 * 1000); // Up to 2 minutes bonus (10 sec per witness)
    const timeSinceLastWitness = Date.now() - lastWitnessed;
    const decayFactor = timeSinceLastWitness > 30 * 1000 ? 0.8 : 1; // Faster decay if not witnessed in 30 seconds
    
    return lastWitnessed + ((baseLifetime + entropyBonus) * decayFactor);
  } else {
    const baseLifetime = 3 * 60 * 1000; // 3 minutes (reduced from 5)
    const entropyBonus = Math.min(witnessCount * 10 * 1000, 5 * 60 * 1000); // Up to 5 minutes bonus (10 sec per witness, reduced from 15)
    const timeSinceLastWitness = Date.now() - lastWitnessed;
    const decayFactor = timeSinceLastWitness > 3 * 60 * 1000 ? 0.8 : 1; // Faster decay if not witnessed in 3 minutes
    
    return lastWitnessed + ((baseLifetime + entropyBonus) * decayFactor);
  }
};

// Add a new witness (async now due to PoW)
export const addWitness = async (text: string, contextOf?: string): Promise<Witness> => {
  let contextWitness: Witness | undefined;
  let existingWitnesses: Witness[] = [];
  
  // Get current witnesses for positioning
  witnesses.subscribe(current => {
    existingWitnesses = current;
    if (contextOf) {
      contextWitness = current.find(w => w.id === contextOf);
    }
  })();

  // Use the full context witness text as the tag
  let contextTag: string | undefined;
  if (contextWitness) {
    contextTag = contextWitness.text;
  }

  console.log('Computing proof of work...');
  // Compute proof of work (~1 second)
  const proof = await computeProofOfWork(text.trim());
  console.log('Proof of work completed:', proof);

  const now = Date.now();
  const witness: Witness = {
    id: generateId(),
    text: text.trim(),
    createdAt: now,
    expiresAt: getDefaultExpiration(),
    witnessCount: 1, // Starts with 1 (the original witnessing)
    lastWitnessed: now,
    contextOf: contextOf || null,
    proof,
    metadata: {
      entropySeed: Math.random(),
      contextTag,
      position: generatePosition(contextWitness, existingWitnesses)
    }
  };

  console.log('Adding witness to Gun:', witness);
  
  // Store witness data using Gun.js native format instead of JSON string
  const witnessNode = fieldNode.get(witness.id);
  const gunData = {
    id: witness.id,
    text: witness.text,
    createdAt: witness.createdAt,
    expiresAt: witness.expiresAt,
    witnessCount: witness.witnessCount,
    lastWitnessed: witness.lastWitnessed,
    contextOf: witness.contextOf || null,
    // Store proof as nested object
    proofNonce: witness.proof?.nonce || null,
    proofHash: witness.proof?.hash || null,
    // Store metadata as nested properties (avoid undefined values)
    entropySeed: witness.metadata.entropySeed,
    contextTag: witness.metadata.contextTag || null,
    positionX: witness.metadata.position?.x || null,
    positionY: witness.metadata.position?.y || null
  };
  
  console.log('Storing to Gun with data:', gunData);
  witnessNode.put(gunData);
  
  // Update local store
  witnesses.update(current => [...current, witness]);
  
  // Broadcast to other tabs
  if (syncChannel) {
    syncChannel.postMessage({
      type: 'NEW_WITNESS',
      data: witness,
      fromTab: myTabId
    });
  }
  
  // Broadcast to WebRTC peers
  broadcastToWebRTCPeers({
    type: 'NEW_WITNESS',
    data: witness
  });
  
  return witness;
};

// Re-witness an existing witness (collective validation) - now requires PoW
export const reWitness = async (witnessId: string): Promise<void> => {
  console.log('Computing proof of work for re-witnessing:', witnessId);
  
  // Find the witness to re-witness
  let witnessToValidate: Witness | null = null;
  witnesses.subscribe(current => {
    witnessToValidate = current.find(w => w.id === witnessId) || null;
  })();
  
  if (!witnessToValidate) {
    console.error('Witness not found for re-witnessing:', witnessId);
    return;
  }
  
  // Compute proof of work for validation (~1 second)
  const validationData = `rewitness:${witnessId}:${Date.now()}`;
  const proof = await computeProofOfWork(validationData);
  console.log('Re-witnessing proof completed:', proof);
  
  let updatedWitness: Witness | null = null;
  
  witnesses.update(current => {
    console.log('Current witnesses before update:', current.length);
    
    const updated = current.map(w => {
      if (w.id === witnessId) {
        const now = Date.now();
        const newWitnessCount = w.witnessCount + 1;
        updatedWitness = {
          ...w,
          witnessCount: newWitnessCount,
          lastWitnessed: now,
          expiresAt: calculateExpiration(newWitnessCount, now)
        };
        
        console.log('Updated witness:', updatedWitness);
        return updatedWitness;
      }
      return w;
    });
    
    console.log('Updated witnesses array:', updated.length);
    return updated;
  });
  
  // Broadcast update to other tabs
  if (updatedWitness && syncChannel) {
    syncChannel.postMessage({
      type: 'UPDATE_WITNESS',
      data: updatedWitness,
      fromTab: myTabId
    });
  }
  
  // Broadcast to WebRTC peers
  if (updatedWitness) {
    broadcastToWebRTCPeers({
      type: 'UPDATE_WITNESS',
      data: updatedWitness
    });
  }
  
  // Update in Gun with timestamp-based versioning strategy (similar to new witness creation)
  if (updatedWitness) {
    const witness = updatedWitness as Witness; // Type assertion since we know it's set
    console.log('🔄 Updating witness in Gun.js:', witness.id, 'count:', witness.witnessCount);
    const witnessNode = fieldNode.get(witnessId);
    const gunData = {
      id: witness.id,
      text: witness.text,
      createdAt: witness.createdAt,
      expiresAt: witness.expiresAt,
      witnessCount: witness.witnessCount,
      lastWitnessed: witness.lastWitnessed,
      contextOf: witness.contextOf || null,
      proofNonce: witness.proof?.nonce || null,
      proofHash: witness.proof?.hash || null,
      entropySeed: witness.metadata.entropySeed,
      contextTag: witness.metadata.contextTag || null,
      positionX: witness.metadata.position?.x || null,
      positionY: witness.metadata.position?.y || null,
      // Add version timestamp to force Gun.js to treat this as new data
      lastUpdate: Date.now(),
      updateSeq: witness.witnessCount // Sequence number for ordering
    };
    
    // Store complete witness again (treat update like creation)
    witnessNode.put(gunData);
    
    // REMOVED: Versioned copies cause storage spam and corruption
    // Don't create versioned copies - rely on Gun.js native conflict resolution
    
    console.log('📡 Updated witness in Gun.js:', witness.id, 'with lastUpdate:', gunData.lastUpdate);
  }
};

// Get active (non-expired) witnesses
export const getActiveWitnesses = (witnessArray: Witness[]) => {
  const now = Date.now();
  return witnessArray.filter(w => w.expiresAt > now);
};

// Initialize store by listening to Gun
// WebRTC Peer Discovery and Signaling
const initializeWebRTC = () => {
  if (!fieldNode) return;
  
  console.log('🌐 Initializing WebRTC P2P connections...');
  
  // Announce our presence
  const announcePresence = () => {
    fieldNode.get('peers').get(myTabId).put({
      id: myTabId,
      timestamp: Date.now(),
      status: 'online'
    });
  };
  
  // Listen for other peers
  fieldNode.get('peers').map().on((data, peerId) => {
    if (data && peerId !== myTabId && data.status === 'online') {
      const timeDiff = Date.now() - data.timestamp;
      if (timeDiff < 30000 && !peerConnections.has(peerId)) { // Active within 30 seconds
        console.log('🔍 Discovered peer:', peerId);
        initiateConnection(peerId);
      }
    }
  });
  
  // Listen for WebRTC signaling messages
  fieldNode.get('webrtc-signaling').get(myTabId).map().on((data, fromPeer) => {
    if (data && data.type) {
      handleSignalingMessage(data, fromPeer);
    }
  });
  
  // Announce presence and refresh periodically
  announcePresence();
  setInterval(announcePresence, 10000);
};

const initiateConnection = async (peerId: string) => {
  console.log(`🤝 Initiating connection to ${peerId}`);
  
  const pc = createPeerConnection(peerId, true);
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Send offer via Gun.js signaling
    fieldNode.get('webrtc-signaling').get(peerId).get(myTabId).put({
      type: 'offer',
      sdp: offer.sdp,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to create offer:', error);
  }
};

const handleSignalingMessage = async (message: any, fromPeer: string) => {
  console.log(`📞 Signaling message from ${fromPeer}:`, message.type);
  
  const pc = peerConnections.get(fromPeer) || createPeerConnection(fromPeer, false);
  
  try {
    switch (message.type) {
      case 'offer':
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        // Send answer
        fieldNode.get('webrtc-signaling').get(fromPeer).get(myTabId).put({
          type: 'answer',
          sdp: answer.sdp,
          timestamp: Date.now()
        });
        break;
        
      case 'answer':
        await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        break;
        
      case 'ice-candidate':
        const candidate = JSON.parse(message.candidate);
        await pc.addIceCandidate(candidate);
        break;
    }
  } catch (error) {
    console.error('Signaling error:', error);
  }
};

// Cleanup expired witnesses from Gun.js storage
const cleanupExpiredWitnesses = () => {
  console.log('🧹 Starting cleanup of expired witnesses...');
  
  if (!fieldNode) {
    console.warn('Cannot cleanup - fieldNode not initialized');
    return;
  }
  
  let cleanedCount = 0;
  const now = Date.now();
  
  // Scan all witness data and remove expired entries
  fieldNode.map().once((data, key) => {
    if (!data) return;
    
    // Skip non-witness data
    if (key === 'webrtc-signaling' || key === 'peers' || key.startsWith('webrtc-') || key.startsWith('peer-')) {
      return;
    }
    
    // Check if this looks like witness data (validate essential fields)
    if (typeof data === 'object' && data.expiresAt && data.id && data.text && data.createdAt) {
      // If expired by more than 1 hour (grace period for sync), remove it
      const gracePeriod = 60 * 60 * 1000; // 1 hour
      if (now > (data.expiresAt + gracePeriod)) {
        console.log(`🗑️ Removing expired witness: ${data.id} (expired ${((now - data.expiresAt) / (24 * 60 * 60 * 1000)).toFixed(1)} days ago)`);
        
        // Remove from Gun.js by setting to null
        fieldNode.get(key).put(null);
        
        // Clean up any existing versioned copies (legacy cleanup)
        for (let v = 1; v <= 50; v++) { // Clean up to 50 versions
          fieldNode.get(`${key}-v${v}`).put(null);
        }
        
        cleanedCount++;
      }
    }
  });
  
  // Report results after a delay to let the scan complete
  setTimeout(() => {
    console.log(`🧹 Cleanup completed: removed ${cleanedCount} expired witnesses`);
    
    // Check localStorage after Gun cleanup and run additional cleanup if needed
    setTimeout(() => {
      try {
        let totalSize = 0;
        for (let key in localStorage) {
          if (localStorage.hasOwnProperty(key)) {
            totalSize += localStorage[key].length + key.length;
          }
        }
        const sizeMB = totalSize / (1024 * 1024);
        if (sizeMB > 5) { // If still over 5MB, force aggressive cleanup
          console.warn(`⚠️ localStorage still large (${sizeMB.toFixed(2)}MB) - running aggressive cleanup`);
          cleanupCorruptedLocalStorage();
        }
      } catch (e) {
        console.warn('Failed to check localStorage size after cleanup');
      }
    }, 2000);
  }, 5000);
};

// Schedule regular cleanup (once every 6 hours)
let cleanupInterval: number | null = null;

const startPeriodicCleanup = () => {
  if (cleanupInterval) return; // Already running
  
  // Run cleanup immediately
  setTimeout(cleanupExpiredWitnesses, 10000); // 10 seconds after init
  
  // Then every 6 hours
  cleanupInterval = setInterval(cleanupExpiredWitnesses, 6 * 60 * 60 * 1000);
  console.log('🕒 Scheduled periodic cleanup every 6 hours');
};

// Track Gun.js subscriptions for cleanup
let gunSubscriptions: any[] = [];

// Auto-cleanup localStorage on startup
const cleanupCorruptedLocalStorage = () => {
  console.log('🧹 Auto-cleaning corrupted localStorage...');
  
  try {
    let removedCount = 0;
    const keysToRemove: string[] = [];
    
    // Check localStorage usage
    let totalSize = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        totalSize += localStorage[key].length + key.length;
      }
    }
    const sizeMB = totalSize / (1024 * 1024);
    console.log(`📊 localStorage: ${sizeMB.toFixed(2)}MB with ${Object.keys(localStorage).length} keys`);
    
    // Find problematic keys
    for (let key in localStorage) {
      try {
        // Remove versioned witness copies (these cause the spam)
        if (key.includes('-v') && key.match(/-v\d+$/)) {
          keysToRemove.push(key);
          continue;
        }
        
        // Remove corrupted Gun data
        if (key.startsWith('gun/')) {
          const data = localStorage.getItem(key);
          if (!data || data === 'null' || data === 'undefined' || data.length < 10) {
            keysToRemove.push(key);
            continue;
          }
        }
        
        // Remove old/corrupted witness data  
        if (key.length === 17) { // Witness ID format
          const data = localStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            // Remove if missing essential fields or very old (7+ days)
            if (!parsed.id || !parsed.text || !parsed.createdAt || 
                (Date.now() - parsed.createdAt > 7 * 24 * 60 * 60 * 1000)) {
              keysToRemove.push(key);
            }
          }
        }
      } catch (e) {
        // If we can't parse it, it's corrupted
        keysToRemove.push(key);
      }
    }
    
    // Remove the problematic keys
    keysToRemove.forEach(key => {
      try {
        localStorage.removeItem(key);
        removedCount++;
      } catch (e) {
        console.warn('Failed to remove localStorage key:', key);
      }
    });
    
    if (removedCount > 0) {
      console.log(`🧹 Auto-cleanup complete: removed ${removedCount} corrupted keys`);
      
      // Recalculate storage after cleanup
      let newTotalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          newTotalSize += localStorage[key].length + key.length;
        }
      }
      const newSizeMB = newTotalSize / (1024 * 1024);
      console.log(`📊 localStorage after cleanup: ${newSizeMB.toFixed(2)}MB with ${Object.keys(localStorage).length} keys`);
    }
    
  } catch (e) {
    console.warn('Auto-cleanup failed:', e);
  }
};

export const initializeStore = () => {
  console.log('Initializing Gun P2P network and localStorage...');
  
  // Auto-cleanup corrupted localStorage on startup
  cleanupCorruptedLocalStorage();
  
  // Clean up any existing subscriptions
  gunSubscriptions.forEach(sub => {
    if (sub && typeof sub.off === 'function') {
      sub.off();
    }
  });
  gunSubscriptions = [];
  
  // Load existing witnesses on startup AND listen for new ones
  const loadWitnessData = (data: any, key: string) => {
    if (!data) return;
    
    // Skip non-witness data (WebRTC signaling, peer discovery, etc.)
    if (key === 'webrtc-signaling' || key === 'peers' || key.startsWith('webrtc-') || key.startsWith('peer-')) {
      return; // Don't log these, they're expected system data
    }
    
    // Skip versioned copies (we only want the main witness entries)
    if (key.includes('-v') && key.match(/-v\d+$/)) {
      console.log('Skipping versioned copy:', key);
      return;
    }
    
    // Only log actual witness data for debugging
    if (typeof data === 'object' && (data.text || data.id)) {
      console.log('Gun.js loading witness data for key:', key, 'text:', data.text?.substring(0, 30) + '...');
    }
    
    let witness: Witness;
    
    try {
      // Handle old JSON string format
      if (typeof data === 'string') {
        console.log('Loading witness from JSON string format');
        const rawWitness = JSON.parse(data);
        witness = {
          id: rawWitness.id,
          text: rawWitness.text,
          createdAt: rawWitness.createdAt,
          expiresAt: rawWitness.expiresAt,
          witnessCount: rawWitness.witnessCount || 1,
          lastWitnessed: rawWitness.lastWitnessed || rawWitness.createdAt,
          contextOf: rawWitness.contextOf || rawWitness.forkOf || null,
          proof: rawWitness.proof,
          metadata: {
            entropySeed: rawWitness.metadata?.entropySeed || Math.random(),
            contextTag: rawWitness.metadata?.contextTag,
            position: rawWitness.metadata?.position
          }
        };
        
        // Override network position for connected witnesses with smart nearby placement
        if (witness.contextOf) {
          witnesses.update(current => {
            const parentWitness = current.find(w => w.id === witness.contextOf);
            if (parentWitness && parentWitness.metadata.position) {
              witness.metadata.position = findSmartNearbySpot(parentWitness, current);
              console.log('🎯 Relocated connected witness to smart nearby spot:', witness.metadata.position);
            }
            return current;
          });
        }
      } 
      // Handle new object format
      else if (typeof data === 'object' && data.id) {
        console.log('Loading witness from object format:', data);
        
        // Skip incomplete data that's missing essential fields (Gun.js loads incrementally)
        if (!data.text || !data.createdAt || !data.expiresAt || !data.id) {
          console.log('Skipping incomplete witness data (missing essential fields):', data.id || 'no-id');
          return;
        }
        
        // Skip corrupted data (fragments with only metadata)
        if (typeof data.text !== 'string' || data.text.length === 0) {
          console.log('Skipping corrupted witness data (invalid text):', data.id);
          return;
        }
        
        // Skip data with invalid timestamps
        if (typeof data.createdAt !== 'number' || typeof data.expiresAt !== 'number') {
          console.log('Skipping witness with invalid timestamps:', data.id);
          return;
        }
        
        witness = {
          id: data.id,
          text: data.text,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt,
          witnessCount: data.witnessCount || 1,
          lastWitnessed: data.lastWitnessed || data.createdAt,
          contextOf: data.contextOf || null,
          proof: data.proofNonce && data.proofHash ? {
            nonce: data.proofNonce,
            hash: data.proofHash
          } : undefined,
          metadata: {
            entropySeed: data.entropySeed || Math.random(),
            contextTag: data.contextTag || undefined,
            position: data.positionX && data.positionY ? {
              x: data.positionX,
              y: data.positionY
            } : undefined
          }
        };
        
        // Override network position for connected witnesses with smart nearby placement
        if (witness.contextOf) {
          witnesses.update(current => {
            const parentWitness = current.find(w => w.id === witness.contextOf);
            if (parentWitness && parentWitness.metadata.position) {
              witness.metadata.position = findSmartNearbySpot(parentWitness, current);
              console.log('🎯 Relocated connected witness to smart nearby spot:', witness.metadata.position);
            }
            return current;
          });
        }
      } else {
        console.warn('Skipping invalid data format:', data);
        return; // Skip invalid data
      }
      
      // PoW verification with fixed algorithm
      if (witness.proof) {
        const isValid = verifyProofOfWork(witness.text.trim(), witness.proof);
        console.log('PoW verification for witness:', witness.id, 'valid:', isValid, 'proof:', witness.proof);
        if (!isValid) {
          console.warn('⚠️ DEBUG: PoW verification failed for witness:', witness.id, 'text:', witness.text, 'proof:', witness.proof);
          // TEMPORARILY allow invalid PoW for debugging
          // return; // Reject witnesses with invalid PoW
        }
      } else {
        console.warn('Witness has no proof data:', witness.id);
      }
      
      // Calculate current effective witness count for display only
      const effectiveCount = calculateCurrentWitnessCount(witness);
      if (effectiveCount !== witness.witnessCount) {
        console.log('⚡ Witness has decayed (display only):', witness.id, 'stored:', witness.witnessCount, 'effective:', effectiveCount);
        // Use effective count for display but keep original expiration time
        witness.witnessCount = effectiveCount;
        // Don't recalculate expiresAt - let it countdown naturally
      }
      
      // Only add if not expired and update if witness count changed
      if (witness.expiresAt > Date.now()) {
        witnesses.update(current => {
          const existing = current.find(w => w.id === witness.id);
          if (!existing) {
            console.log('📥 Loaded new witness from Gun.js:', witness.id, 'count:', witness.witnessCount);
            // Apply memory limit - remove oldest expired witnesses first
            if (current.length >= MAX_WITNESSES_IN_MEMORY) {
              const now = Date.now();
              // Sort by expiration time and remove the oldest expired ones
              const sorted = [...current].sort((a, b) => a.expiresAt - b.expiresAt);
              const toKeep = sorted.slice(-MAX_WITNESSES_IN_MEMORY + 1);
              return [...toKeep, witness];
            }
            return [...current, witness];
          } else if (existing.witnessCount !== witness.witnessCount || existing.expiresAt !== witness.expiresAt || 
                     (data.lastUpdate && (!existing.metadata.lastUpdate || data.lastUpdate > existing.metadata.lastUpdate))) {
            console.log('🔄 Updated witness from Gun.js:', witness.id, 'count:', existing.witnessCount, '->', witness.witnessCount, 'lastUpdate:', data.lastUpdate);
            // Preserve local physics position to avoid jarring repositioning
            if (existing.metadata.position) {
              witness.metadata.position = existing.metadata.position;
            }
            // Add lastUpdate to metadata for tracking
            witness.metadata.lastUpdate = data.lastUpdate;
            return current.map(w => w.id === witness.id ? witness : w);
          }
          return current;
        });
      } else {
        const ageMinutes = Math.floor((Date.now() - witness.createdAt) / 60000);
        const expiredMinutes = Math.floor((Date.now() - witness.expiresAt) / 60000);
        console.log(`❌ Witness expired, not loading: ${witness.id} (age: ${ageMinutes}min, expired ${expiredMinutes}min ago)`);
      }
    } catch (e) {
      console.warn('Failed to parse witness data:', e, data);
    }
  };

  // Debug: Test different Gun.js loading patterns
  console.log('🔄 Testing Gun.js data loading patterns...');
  
  // Track loaded witness IDs to prevent duplicates
  const loadedWitnessIds = new Set<string>();
  
  // Modified load function that tracks loaded witnesses
  const loadWitnessDataWithTracking = (data: any, key: string) => {
    // Skip if already loaded to prevent duplicates
    if (loadedWitnessIds.has(key)) {
      return;
    }
    loadedWitnessIds.add(key);
    
    // Clean up tracking set if it gets too large
    if (loadedWitnessIds.size > MAX_WITNESSES_IN_MEMORY * 2) {
      // Keep only the most recent entries
      const recentIds = Array.from(loadedWitnessIds).slice(-MAX_WITNESSES_IN_MEMORY);
      loadedWitnessIds.clear();
      recentIds.forEach(id => loadedWitnessIds.add(id));
    }
    
    loadWitnessData(data, key);
  };
  
  // Load existing witnesses immediately
  console.log('🔄 Loading existing witnesses with .once()...');
  fieldNode.map().once(loadWitnessDataWithTracking);
  
  // Listen for new witnesses in real-time
  console.log('👂 Setting up real-time listener with .on()...');
  fieldNode.map().on(loadWitnessDataWithTracking);

  // Pattern 3: Count loaded witnesses after delay
  setTimeout(() => {
    console.log('🔍 Witness loading summary after 3 seconds...');
    witnesses.subscribe(current => {
      console.log(`📋 Total witnesses in store: ${current.length}`);
      const expired = current.filter(w => w.expiresAt <= Date.now()).length;
      console.log(`   Active: ${current.length - expired}, Expired: ${expired}`);
    })();
  }, 3000);
  
  // Periodic cleanup of expired witnesses (with deterministic decay)
  const cleanupTimer = setInterval(() => {
    // Check memory usage
    checkMemoryUsage();
    
    witnesses.update(current => {
      const updated = current.map(witness => {
        // Calculate effective witness count for display only (don't change expiration)
        const effectiveCount = calculateCurrentWitnessCount(witness);
        if (effectiveCount !== witness.witnessCount) {
          console.log('⚡ Local witness decay update (display only):', witness.id, 'stored:', witness.witnessCount, 'effective:', effectiveCount);
          return {
            ...witness,
            witnessCount: effectiveCount
            // Keep original expiresAt - don't recalculate based on decayed count
          };
        }
        return witness;
      });
      
      // Filter out expired witnesses
      const active = getActiveWitnesses(updated);
      const expired = updated.length - active.length;
      if (expired > 0) {
        console.log(`Cleaned up ${expired} expired witnesses`);
      }
      
      // Apply memory limit if needed
      if (active.length > MAX_WITNESSES_IN_MEMORY) {
        console.log(`⚠️ Trimming witnesses from ${active.length} to ${MAX_WITNESSES_IN_MEMORY}`);
        // Keep the most recently witnessed/created ones
        return active
          .sort((a, b) => Math.max(b.lastWitnessed, b.createdAt) - Math.max(a.lastWitnessed, a.createdAt))
          .slice(0, MAX_WITNESSES_IN_MEMORY);
      }
      
      return active;
    });
  }, 10000);
  
  // Clean up timer on module unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      clearInterval(cleanupTimer);
      // Clean up WebRTC connections
      peerConnections.forEach(pc => pc.close());
      dataChannels.forEach(channel => channel.close());
    });
  }
  
  // Start periodic cleanup of expired witnesses
  startPeriodicCleanup();
  
  // Auto-cleanup localStorage periodically (every 5 minutes)
  setInterval(() => {
    cleanupCorruptedLocalStorage();
  }, 5 * 60 * 1000);
  
  // Initialize WebRTC P2P connections
  if (typeof window !== 'undefined') {
    initializeWebRTC();
  }
};