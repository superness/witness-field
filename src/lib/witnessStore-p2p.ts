import Gun from 'gun';
import type { Witness } from './types.js';
import { writable } from 'svelte/store';

console.log('🌐 TRUE P2P WITNESS STORE - WebRTC Direct Mode');

// P2P Configuration: Gun.js for discovery only, WebRTC for data
const P2P_CONFIG = {
  maxWitnesses: 200,              // Reasonable memory limit
  expirationTime: 10 * 60 * 1000, // 10 minutes in dev mode
  cleanupInterval: 60 * 1000,      // Clean every minute
  maxConnections: 8,               // Limit WebRTC connections
  connectionTimeout: 10000,        // 10 second WebRTC timeout
  heartbeatInterval: 30000,        // 30 second peer heartbeat
};

// Gun.js ONLY for peer discovery - no data storage
const gun = Gun({
  peers: [
    'https://the-witness-field-production.up.railway.app/gun',
    'wss://the-witness-field-production.up.railway.app/gun'
  ],
  localStorage: false,   // CRITICAL: No localStorage 
  radisk: false,         // No browser persistence
  retry: 1,
  timeout: 5000
});

// Separate namespaces for discovery vs emergency fallback
const DISCOVERY_NAMESPACE = 'witness-field-p2p-discovery-v1';
const FALLBACK_NAMESPACE = 'witness-field-emergency-v1';

// Peer discovery node (for WebRTC signaling only)
const discoveryNode = gun.get(DISCOVERY_NAMESPACE);
const fallbackNode = gun.get(FALLBACK_NAMESPACE);

console.log('🔍 P2P Discovery namespace:', DISCOVERY_NAMESPACE);

// Svelte stores
export const witnesses = writable<Witness[]>([]);
export const connectionStatus = writable<{
  mode: 'p2p' | 'relay' | 'offline';
  peerCount: number;
  webrtcConnections: number;
  relayConnected: boolean;
}>({
  mode: 'offline',
  peerCount: 0,
  webrtcConnections: 0,
  relayConnected: false
});

// In-memory witness storage (the source of truth)
let witnessMemory = new Map<string, Witness>();
let lastCleanup = Date.now();

// WebRTC Connection Management
class P2PManager {
  private connections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private peerId: string;
  private discoveryRef: any;
  
  constructor() {
    this.peerId = this.generatePeerId();
    console.log('🆔 P2P Peer ID:', this.peerId);
    this.startPeerDiscovery();
  }

  private generatePeerId(): string {
    return 'peer_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
  }

  private startPeerDiscovery() {
    // Announce presence for other peers to discover
    this.discoveryRef = discoveryNode.get('peers').get(this.peerId);
    this.discoveryRef.put({
      id: this.peerId,
      timestamp: Date.now(),
      active: true
    });

    // Listen for other peers
    discoveryNode.get('peers').map().on((data: any, key: string) => {
      if (data && key !== this.peerId && data.active && data.timestamp > Date.now() - 60000) {
        this.attemptConnection(key, data);
      }
    });

    // Heartbeat to maintain presence
    setInterval(() => {
      this.discoveryRef.put({
        id: this.peerId,
        timestamp: Date.now(),
        active: true
      });
    }, P2P_CONFIG.heartbeatInterval);

    console.log('📡 Started peer discovery');
  }

  private async attemptConnection(peerId: string, peerData: any) {
    if (this.connections.has(peerId) || this.connections.size >= P2P_CONFIG.maxConnections) {
      return; // Already connected or at limit
    }

    console.log('🤝 Attempting connection to peer:', peerId);

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Create data channel for witness exchange
      const dataChannel = peerConnection.createDataChannel('witnesses', {
        ordered: true
      });

      this.setupDataChannel(dataChannel, peerId);
      this.connections.set(peerId, peerConnection);

      // Handle incoming data channels
      peerConnection.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerId);
      };

      // ICE candidate handling via Gun.js signaling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          discoveryNode.get('signaling').get(peerId).get(this.peerId).put({
            type: 'ice-candidate',
            candidate: event.candidate,
            timestamp: Date.now()
          });
        }
      };

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      discoveryNode.get('signaling').get(peerId).get(this.peerId).put({
        type: 'offer',
        offer: offer,
        timestamp: Date.now()
      });

      // Listen for answer and ICE candidates
      discoveryNode.get('signaling').get(this.peerId).get(peerId).on(async (data: any) => {
        if (!data) return;

        if (data.type === 'answer' && peerConnection.signalingState === 'have-local-offer') {
          await peerConnection.setRemoteDescription(data.answer);
        } else if (data.type === 'offer' && !this.connections.has(peerId)) {
          // Handle incoming offer (if we don't already have connection)
          await this.handleIncomingOffer(peerId, data.offer);
        } else if (data.type === 'ice-candidate') {
          await peerConnection.addIceCandidate(data.candidate);
        }
      });

      // Connection state monitoring
      peerConnection.onconnectionstatechange = () => {
        console.log(`🔗 Connection to ${peerId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
          this.cleanupConnection(peerId);
        }
        this.updateConnectionStatus();
      };

    } catch (error) {
      console.error('❌ Connection attempt failed:', error);
      this.cleanupConnection(peerId);
    }
  }

  private async handleIncomingOffer(peerId: string, offer: RTCSessionDescriptionInit) {
    if (this.connections.has(peerId)) return;

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    this.connections.set(peerId, peerConnection);

    peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, peerId);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        discoveryNode.get('signaling').get(peerId).get(this.peerId).put({
          type: 'ice-candidate',
          candidate: event.candidate,
          timestamp: Date.now()
        });
      }
    };

    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    discoveryNode.get('signaling').get(peerId).get(this.peerId).put({
      type: 'answer',
      answer: answer,
      timestamp: Date.now()
    });
  }

  private setupDataChannel(channel: RTCDataChannel, peerId: string) {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log('📡 Data channel opened with peer:', peerId);
      // Send current witnesses to new peer
      this.sendWitnessesToPeer(peerId);
      this.updateConnectionStatus();
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handlePeerMessage(message, peerId);
      } catch (error) {
        console.error('❌ Failed to parse peer message:', error);
      }
    };

    channel.onclose = () => {
      console.log('📴 Data channel closed with peer:', peerId);
      this.dataChannels.delete(peerId);
      this.updateConnectionStatus();
    };

    channel.onerror = (error) => {
      console.error('❌ Data channel error with peer:', peerId, error);
    };
  }

  private sendWitnessesToPeer(peerId: string) {
    const channel = this.dataChannels.get(peerId);
    if (!channel || channel.readyState !== 'open') return;

    const witnessArray = Array.from(witnessMemory.values());
    const message = {
      type: 'witness-sync',
      witnesses: witnessArray,
      timestamp: Date.now()
    };

    try {
      channel.send(JSON.stringify(message));
      console.log(`📤 Sent ${witnessArray.length} witnesses to peer:`, peerId);
    } catch (error) {
      console.error('❌ Failed to send witnesses to peer:', error);
    }
  }

  private handlePeerMessage(message: any, peerId: string) {
    switch (message.type) {
      case 'witness-sync':
        this.mergePeerWitnesses(message.witnesses, peerId);
        break;
      case 'witness-new':
        this.addPeerWitness(message.witness, peerId);
        break;
      case 'witness-update':
        this.updatePeerWitness(message.witness, peerId);
        break;
      default:
        console.warn('🤷 Unknown message type from peer:', message.type);
    }
  }

  private mergePeerWitnesses(peerWitnesses: Witness[], peerId: string) {
    let newCount = 0;
    let updatedCount = 0;

    peerWitnesses.forEach(witness => {
      const existing = witnessMemory.get(witness.id);
      if (!existing) {
        witnessMemory.set(witness.id, witness);
        newCount++;
      } else if (witness.witnessCount > existing.witnessCount) {
        witnessMemory.set(witness.id, { ...existing, witnessCount: witness.witnessCount });
        updatedCount++;
      }
    });

    if (newCount > 0 || updatedCount > 0) {
      console.log(`📥 Merged from ${peerId}: ${newCount} new, ${updatedCount} updated`);
      this.updateWitnessStore();
    }
  }

  private addPeerWitness(witness: Witness, peerId: string) {
    if (!witnessMemory.has(witness.id)) {
      witnessMemory.set(witness.id, witness);
      console.log(`📥 New witness from ${peerId}:`, witness.id);
      this.updateWitnessStore();
    }
  }

  private updatePeerWitness(witness: Witness, peerId: string) {
    const existing = witnessMemory.get(witness.id);
    if (existing && witness.witnessCount > existing.witnessCount) {
      witnessMemory.set(witness.id, { ...existing, witnessCount: witness.witnessCount });
      console.log(`📥 Updated witness from ${peerId}:`, witness.id);
      this.updateWitnessStore();
    }
  }

  public broadcastWitness(witness: Witness, type: 'new' | 'update' = 'new') {
    const message = {
      type: type === 'new' ? 'witness-new' : 'witness-update',
      witness: witness,
      timestamp: Date.now()
    };

    const messageStr = JSON.stringify(message);
    let broadcastCount = 0;

    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        try {
          channel.send(messageStr);
          broadcastCount++;
        } catch (error) {
          console.error(`❌ Failed to broadcast to ${peerId}:`, error);
        }
      }
    });

    console.log(`📤 Broadcasted ${type} witness to ${broadcastCount} peers`);
    return broadcastCount;
  }

  private cleanupConnection(peerId: string) {
    this.connections.get(peerId)?.close();
    this.connections.delete(peerId);
    this.dataChannels.delete(peerId);
    console.log('🧹 Cleaned up connection to:', peerId);
    this.updateConnectionStatus();
  }

  public updateConnectionStatus() {
    const webrtcConnections = this.dataChannels.size;
    const relayConnected = isRelayConnected;
    
    let mode: 'p2p' | 'relay' | 'offline' = 'offline';
    if (webrtcConnections > 0) {
      mode = 'p2p';
    } else if (relayConnected) {
      mode = 'relay';
    }

    connectionStatus.set({
      mode,
      peerCount: this.connections.size,
      webrtcConnections,
      relayConnected
    });
  }

  private updateWitnessStore() {
    const witnessArray = Array.from(witnessMemory.values())
      .filter(w => w.expiresAt > Date.now())
      .sort((a, b) => b.createdAt - a.createdAt);
    
    witnesses.set(witnessArray);
  }

  public cleanup() {
    // Mark as inactive in discovery
    this.discoveryRef?.put({
      id: this.peerId,
      timestamp: Date.now(),
      active: false
    });

    // Close all connections
    this.connections.forEach((_, peerId) => this.cleanupConnection(peerId));
  }
}

// Global P2P manager instance
let p2pManager: P2PManager | null = null;

// Relay connection tracking (fallback)
let isRelayConnected = false;
let relayConnectedPeers = new Set<string>();

gun.on('hi', (peer) => {
  if (peer && peer.url) {
    console.log('🟢 Relay connected (fallback):', peer.url);
    relayConnectedPeers.add(peer.url);
    isRelayConnected = true;
  } else {
    console.log('💾 Gun ready');
    isRelayConnected = true;
  }
  p2pManager?.updateConnectionStatus();
});

gun.on('bye', (peer) => {
  if (peer && peer.url) {
    console.log('🔴 Relay disconnected:', peer.url);
    relayConnectedPeers.delete(peer.url);
  }
  isRelayConnected = relayConnectedPeers.size > 0;
  p2pManager?.updateConnectionStatus();
});

// Initialize P2P manager
export const initializeStore = () => {
  if (!p2pManager) {
    p2pManager = new P2PManager();
    console.log('🚀 P2P Manager initialized');
    
    // Start cleanup interval
    setInterval(cleanupExpiredWitnesses, P2P_CONFIG.cleanupInterval);
  }
};

// Public API functions
export const addWitness = async (text: string, contextOf?: string): Promise<Witness | null> => {
  try {
    const witness: Witness = {
      id: generateWitnessId(),
      text: text.trim(),
      createdAt: Date.now(),
      expiresAt: Date.now() + P2P_CONFIG.expirationTime,
      witnessCount: 1,
      contextOf,
      metadata: {
        position: generatePosition(contextOf),
        entropySeed: Math.random()
      }
    };

    // Add to local memory
    witnessMemory.set(witness.id, witness);
    
    // Broadcast via WebRTC if available
    const broadcastCount = p2pManager?.broadcastWitness(witness, 'new') || 0;
    
    // Fallback to relay if no P2P connections
    if (broadcastCount === 0 && isRelayConnected) {
      console.log('📡 Fallback: Using relay for witness broadcast');
      fallbackNode.get('witnesses').get(witness.id).put(witness);
    }

    updateWitnessStore();
    console.log('✨ Created witness:', witness.id, `(${broadcastCount} peers)`);
    
    return witness;
  } catch (error) {
    console.error('❌ Failed to create witness:', error);
    return null;
  }
};

export const reWitness = async (witnessId: string): Promise<boolean> => {
  const witness = witnessMemory.get(witnessId);
  if (!witness) return false;

  const updatedWitness = {
    ...witness,
    witnessCount: witness.witnessCount + 1,
    expiresAt: Math.max(witness.expiresAt, Date.now() + P2P_CONFIG.expirationTime)
  };

  witnessMemory.set(witnessId, updatedWitness);
  
  // Broadcast update
  const broadcastCount = p2pManager?.broadcastWitness(updatedWitness, 'update') || 0;
  
  // Fallback to relay
  if (broadcastCount === 0 && isRelayConnected) {
    fallbackNode.get('witnesses').get(witnessId).put(updatedWitness);
  }

  updateWitnessStore();
  console.log('👁️ Re-witnessed:', witnessId, `(${broadcastCount} peers)`);
  
  return true;
};

export const getActiveWitnesses = (witnessArray: Witness[]): Witness[] => {
  const now = Date.now();
  return witnessArray.filter(w => w.expiresAt > now);
};

// Helper functions
function generateWitnessId(): string {
  return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function generatePosition(contextOf?: string): { x: number; y: number } {
  if (contextOf) {
    const parentWitness = witnessMemory.get(contextOf);
    if (parentWitness?.metadata.position) {
      return {
        x: Math.max(5, Math.min(95, parentWitness.metadata.position.x + (Math.random() - 0.5) * 20)),
        y: Math.max(5, Math.min(95, parentWitness.metadata.position.y + (Math.random() - 0.5) * 20))
      };
    }
  }
  
  return {
    x: Math.random() * 90 + 5,
    y: Math.random() * 90 + 5
  };
}

function cleanupExpiredWitnesses() {
  const now = Date.now();
  const before = witnessMemory.size;
  
  for (const [id, witness] of witnessMemory.entries()) {
    if (witness.expiresAt <= now) {
      witnessMemory.delete(id);
    }
  }
  
  // Limit total witnesses in memory
  if (witnessMemory.size > P2P_CONFIG.maxWitnesses) {
    const sorted = Array.from(witnessMemory.entries())
      .sort(([,a], [,b]) => b.createdAt - a.createdAt);
    
    witnessMemory = new Map(sorted.slice(0, P2P_CONFIG.maxWitnesses));
  }
  
  const cleaned = before - witnessMemory.size;
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired witnesses`);
    updateWitnessStore();
  }
  
  lastCleanup = now;
}

function updateWitnessStore() {
  const witnessArray = Array.from(witnessMemory.values())
    .filter(w => w.expiresAt > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt);
  
  witnesses.set(witnessArray);
}

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    p2pManager?.cleanup();
  });
}

console.log('🌐 True P2P witnessStore ready - WebRTC + Gun.js discovery');