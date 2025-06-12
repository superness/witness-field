import Gun from 'gun';
import type { Witness } from './types.js';
import { writable } from 'svelte/store';

// P2P Configuration - choose your approach
const P2P_MODE = 'PUBLIC_RELAY'; // Options: 'LOCAL_ONLY', 'PUBLIC_RELAY', 'CUSTOM_RELAY'

// Initialize Gun based on P2P mode
const gun = (() => {
  switch (P2P_MODE) {
    case 'PUBLIC_RELAY':
      console.log('🌐 Using public relays - will mix with other apps using same namespace');
      return Gun({
        peers: [
          'https://the-witness-field-production.up.railway.app/gun',
          'wss://the-witness-field-production.up.railway.app/gun'
        ],
        localStorage: true,
        radisk: true,
        retry: 1,
        timeout: 5000,
        fallback: true
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
        gun.opt({ peers: gun._.opt.peers });
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

// Svelte store for local state
export const witnesses = writable<Witness[]>([]);
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

// Track WebRTC peer connections
const peerConnections = new Map<string, RTCPeerConnection>();
const dataChannels = new Map<string, RTCDataChannel>();

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
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
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
        
        nonce++;
        
        // Check if we've hit our time target
        if (Date.now() - startTime >= 1000) {
          const finalHash = hash.toString(16);
          resolve({ nonce, hash: finalHash });
          return;
        }
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
  
  return hash.toString(16) === proof.hash;
};

// Development mode - set to true for fast testing
const DEV_MODE = false;

// Helper to create default expiration
const getDefaultExpiration = () => {
  if (DEV_MODE) {
    return Date.now() + (10 * 60 * 1000); // 10 minutes in dev mode for testing persistence
  }
  return Date.now() + (5 * 60 * 1000); // 5 minutes in production
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

// Generate spatial position for field layout - spread out across the full field
const generatePosition = (contextWitness?: Witness, existingWitnesses: Witness[] = []) => {
  let attempts = 0;
  let position: {x: number, y: number};
  
  // Calculate crowding factor to adjust behavior
  const crowdingFactor = Math.min(1, existingWitnesses.length / 50);
  
  do {
    if (contextWitness && contextWitness.metadata.position && attempts < 15) {
      // Position near context witness with larger drift when crowded
      const baseDrift = 8 + Math.random() * 12; // 8-20% base drift
      const crowdingBonus = crowdingFactor * 20; // Extra drift when crowded
      const drift = baseDrift + crowdingBonus;
      const angle = Math.random() * Math.PI * 2;
      
      const newX = Math.max(2, Math.min(98, 
        contextWitness.metadata.position.x + Math.cos(angle) * drift
      ));
      const newY = Math.max(2, Math.min(98, 
        contextWitness.metadata.position.y + Math.sin(angle) * drift
      ));
      
      position = { x: newX, y: newY };
    } else if (existingWitnesses.length > 0 && existingWitnesses.length < 30) {
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
        
        position = { x: newX, y: newY };
      } else {
        // Use full field area
        position = {
          x: 5 + Math.random() * 90, // 5-95% of field (almost full area)
          y: 5 + Math.random() * 90,
        };
      }
    } else {
      // When crowded or first witness - spread across entire field
      position = {
        x: 5 + Math.random() * 90, // Use full 5-95% of field
        y: 5 + Math.random() * 90,
      };
    }
    attempts++;
  } while (isPositionTooClose(position, existingWitnesses, crowdingFactor > 0.5 ? 2 : 4) && attempts < 30);
  
  return position;
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
    const baseLifetime = 1.5 * 60 * 1000; // 1.5 minutes in dev
    const entropyBonus = Math.min(witnessCount * 20 * 1000, 3 * 60 * 1000); // Up to 3 minutes bonus (20 sec per witness)
    const timeSinceLastWitness = Date.now() - lastWitnessed;
    const decayFactor = timeSinceLastWitness > 30 * 1000 ? 0.8 : 1; // Faster decay if not witnessed in 30 seconds
    
    return lastWitnessed + ((baseLifetime + entropyBonus) * decayFactor);
  } else {
    const baseLifetime = 5 * 60 * 1000; // 5 minutes
    const entropyBonus = Math.min(witnessCount * 15 * 1000, 10 * 60 * 1000); // Up to 10 minutes bonus (15 sec per witness)
    const timeSinceLastWitness = Date.now() - lastWitnessed;
    const decayFactor = timeSinceLastWitness > 5 * 60 * 1000 ? 0.8 : 1; // Faster decay if not witnessed in 5 minutes
    
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
    console.log('🔄 Updating witness in Gun.js:', updatedWitness.id, 'count:', updatedWitness.witnessCount);
    const witnessNode = fieldNode.get(witnessId);
    const gunData = {
      id: updatedWitness.id,
      text: updatedWitness.text,
      createdAt: updatedWitness.createdAt,
      expiresAt: updatedWitness.expiresAt,
      witnessCount: updatedWitness.witnessCount,
      lastWitnessed: updatedWitness.lastWitnessed,
      contextOf: updatedWitness.contextOf || null,
      proofNonce: updatedWitness.proof?.nonce || null,
      proofHash: updatedWitness.proof?.hash || null,
      entropySeed: updatedWitness.metadata.entropySeed,
      contextTag: updatedWitness.metadata.contextTag || null,
      positionX: updatedWitness.metadata.position?.x || null,
      positionY: updatedWitness.metadata.position?.y || null,
      // Add version timestamp to force Gun.js to treat this as new data
      lastUpdate: Date.now(),
      updateSeq: updatedWitness.witnessCount // Sequence number for ordering
    };
    
    // Store complete witness again (treat update like creation)
    witnessNode.put(gunData);
    
    // Also create a versioned copy to ensure propagation
    const versionedKey = `${witnessId}-v${updatedWitness.witnessCount}`;
    fieldNode.get(versionedKey).put(gunData);
    
    console.log('📡 Created versioned witness:', versionedKey, 'with lastUpdate:', gunData.lastUpdate);
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

export const initializeStore = () => {
  console.log('Initializing Gun P2P network and localStorage...');
  
  // Load existing witnesses on startup AND listen for new ones
  const loadWitnessData = (data, key) => {
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
      } 
      // Handle new object format
      else if (typeof data === 'object' && data.id) {
        console.log('Loading witness from object format:', data);
        
        // Skip incomplete data that's missing essential fields (Gun.js loads incrementally)
        if (!data.text || !data.createdAt || !data.expiresAt) {
          console.log('Skipping incomplete witness data (will be loaded again when complete):', data.id);
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
      } else {
        console.warn('Skipping invalid data format:', data);
        return; // Skip invalid data
      }
      
      // PoW verification with fixed algorithm
      if (witness.proof) {
        const isValid = verifyProofOfWork(witness.text.trim(), witness.proof);
        console.log('PoW verification for witness:', witness.id, 'valid:', isValid);
        if (!isValid) {
          console.warn('Skipping witness with invalid PoW');
          return;
        }
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
        console.log('❌ Witness expired, not loading:', witness.id);
      }
    } catch (e) {
      console.warn('Failed to parse witness data:', e, data);
    }
  };

  // FIRST: Load existing witnesses immediately (for page refresh)
  console.log('🔄 Loading existing witnesses...');
  fieldNode.map().once(loadWitnessData);
  
  // SECOND: Listen for new witnesses in real-time
  console.log('👂 Setting up real-time witness listener...');
  fieldNode.map().on(loadWitnessData);
  
  // Periodic cleanup of expired witnesses (with deterministic decay)
  setInterval(() => {
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
      return active;
    });
  }, 10000);
  
  // Initialize WebRTC P2P connections
  if (typeof window !== 'undefined') {
    initializeWebRTC();
  }
};