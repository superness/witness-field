import Gun from 'gun';
import type { Witness } from './types.js';
import { writable } from 'svelte/store';

console.log('🚨 EMERGENCY WITNESS STORE - Clean Slate Mode');

// EMERGENCY CONFIGURATION: No localStorage, strict limits
const EMERGENCY_CONFIG = {
  maxWitnesses: 50,           // Hard limit
  expirationTime: 2 * 60 * 1000,  // 2 minutes only
  cleanupInterval: 30 * 1000,      // Clean every 30 seconds
  maxWitnessCount: 10,             // Cap re-witnessing
  disableVersioning: true,         // No versioned copies ever
  disablePersistence: true         // No localStorage at all
};

// Clean Gun.js setup - relay only, no storage
const gun = Gun({
  peers: [
    'https://the-witness-field-production.up.railway.app/gun',
    'wss://the-witness-field-production.up.railway.app/gun'
  ],
  localStorage: false,   // CRITICAL: No localStorage
  radisk: false,         // No browser caching
  retry: 1,
  timeout: 5000
});

// Use a clean namespace (fresh start)
const APP_NAMESPACE = 'witness-field-emergency-v1';
const fieldNode = gun.get(APP_NAMESPACE);

console.log('📡 Using emergency namespace:', APP_NAMESPACE);

// Simple stores
export const witnesses = writable<Witness[]>([]);
export const connectionStatus = writable<{connected: boolean, peerCount: number}>({connected: false, peerCount: 0});

// Connection tracking
let isConnected = false;
let connectedPeers = new Set<string>();

gun.on('hi', (peer) => {
  if (peer && peer.url) {
    console.log('🟢 Emergency relay connected:', peer.url);
    connectedPeers.add(peer.url);
    isConnected = true;
  } else {
    console.log('💾 Gun ready (no localStorage)');
    isConnected = true;
  }
  updateConnectionStatus();
});

gun.on('bye', (peer) => {
  if (peer && peer.url) {
    console.log('🔴 Emergency relay disconnected:', peer.url);
    connectedPeers.delete(peer.url);
  }
  isConnected = connectedPeers.size > 0;
  updateConnectionStatus();
});

const updateConnectionStatus = () => {
  connectionStatus.set({
    connected: isConnected,
    peerCount: connectedPeers.size
  });
};

// Helper functions
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

const getDefaultExpiration = () => Date.now() + EMERGENCY_CONFIG.expirationTime;

const generatePosition = () => ({
  x: 10 + Math.random() * 80,
  y: 10 + Math.random() * 80
});

// Simplified proof of work (no blocking)
const computeProofOfWork = async (text: string): Promise<{nonce: number, hash: string}> => {
  // Very fast PoW for emergency mode
  const nonce = Math.floor(Math.random() * 10000);
  const hash = btoa(text + nonce).substring(0, 8);
  
  // Minimal delay to prevent spam
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return { nonce, hash };
};

// Add witness (simplified, no localStorage)
export const addWitness = async (text: string, contextOf?: string): Promise<Witness> => {
  console.log('🆘 Emergency: Adding witness');
  
  // Check limit
  const currentWitnesses = get(witnesses);
  if (currentWitnesses.length >= EMERGENCY_CONFIG.maxWitnesses) {
    console.warn('⚠️ Emergency limit reached, removing oldest');
    // Remove oldest witness
    const oldest = currentWitnesses.sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) {
      fieldNode.get(oldest.id).put(null);
      witnesses.update(current => current.filter(w => w.id !== oldest.id));
    }
  }
  
  const proof = await computeProofOfWork(text.trim());
  const now = Date.now();
  
  const witness: Witness = {
    id: generateId(),
    text: text.trim(),
    createdAt: now,
    expiresAt: getDefaultExpiration(),
    witnessCount: 1,
    lastWitnessed: now,
    contextOf: contextOf || null,
    proof,
    metadata: {
      entropySeed: Math.random(),
      position: generatePosition()
    }
  };
  
  // Store minimal data in Gun (no versions, no extra fields)
  const gunData = {
    id: witness.id,
    text: witness.text,
    createdAt: witness.createdAt,
    expiresAt: witness.expiresAt,
    witnessCount: witness.witnessCount,
    contextOf: witness.contextOf
  };
  
  console.log('💾 Emergency: Storing minimal data', gunData);
  fieldNode.get(witness.id).put(gunData);
  
  // Update local store
  witnesses.update(current => [...current, witness]);
  
  return witness;
};

// Re-witness (simplified, no versioning)
export const reWitness = async (witnessId: string): Promise<void> => {
  console.log('🆘 Emergency: Re-witnessing', witnessId);
  
  witnesses.update(current => 
    current.map(w => {
      if (w.id === witnessId) {
        const newCount = Math.min(w.witnessCount + 1, EMERGENCY_CONFIG.maxWitnessCount);
        const updated = {
          ...w,
          witnessCount: newCount,
          lastWitnessed: Date.now(),
          expiresAt: getDefaultExpiration() // Reset expiration
        };
        
        // Update Gun with just the essentials (no versioning)
        fieldNode.get(witnessId).put({
          id: updated.id,
          text: updated.text,
          createdAt: updated.createdAt,
          expiresAt: updated.expiresAt,
          witnessCount: updated.witnessCount,
          contextOf: updated.contextOf
        });
        
        return updated;
      }
      return w;
    })
  );
};

// Aggressive cleanup
const emergencyCleanup = () => {
  const now = Date.now();
  
  witnesses.update(current => {
    const expired = current.filter(w => w.expiresAt <= now);
    const active = current.filter(w => w.expiresAt > now);
    
    // Remove expired from Gun
    expired.forEach(w => {
      console.log('🗑️ Emergency cleanup: removing expired witness', w.id);
      fieldNode.get(w.id).put(null);
    });
    
    // If still too many, remove oldest
    if (active.length > EMERGENCY_CONFIG.maxWitnesses) {
      const sorted = active.sort((a, b) => a.createdAt - b.createdAt);
      const toRemove = sorted.slice(0, active.length - EMERGENCY_CONFIG.maxWitnesses);
      
      toRemove.forEach(w => {
        console.log('🗑️ Emergency cleanup: removing excess witness', w.id);
        fieldNode.get(w.id).put(null);
      });
      
      return sorted.slice(-EMERGENCY_CONFIG.maxWitnesses);
    }
    
    return active;
  });
};

// Initialize emergency store
export const initializeStore = () => {
  console.log('🚨 Emergency initialization - localStorage disabled');
  
  // Load witnesses from Gun relay only
  fieldNode.map().on((data, key) => {
    if (!data || !data.id || !data.text) {
      console.log('⚠️ Skipping invalid emergency data:', key);
      return;
    }
    
    // Skip if expired
    if (data.expiresAt && data.expiresAt <= Date.now()) {
      console.log('🗑️ Emergency: Removing expired data on load', key);
      fieldNode.get(key).put(null);
      return;
    }
    
    console.log('📥 Emergency: Loading witness', data.id);
    
    witnesses.update(current => {
      const exists = current.find(w => w.id === data.id);
      if (!exists) {
        // Create witness with minimal metadata
        const witness: Witness = {
          id: data.id,
          text: data.text,
          createdAt: data.createdAt || Date.now(),
          expiresAt: data.expiresAt || getDefaultExpiration(),
          witnessCount: Math.min(data.witnessCount || 1, EMERGENCY_CONFIG.maxWitnessCount),
          lastWitnessed: data.lastWitnessed || data.createdAt || Date.now(),
          contextOf: data.contextOf || null,
          proof: { nonce: 0, hash: 'emergency' },
          metadata: {
            entropySeed: Math.random(),
            position: generatePosition()
          }
        };
        
        // Enforce limit
        if (current.length >= EMERGENCY_CONFIG.maxWitnesses) {
          return current; // Don't add if at limit
        }
        
        return [...current, witness];
      }
      return current;
    });
  });
  
  // Aggressive cleanup timer
  setInterval(emergencyCleanup, EMERGENCY_CONFIG.cleanupInterval);
  
  console.log('✅ Emergency store ready - max', EMERGENCY_CONFIG.maxWitnesses, 'witnesses');
};

// Export helper
export const getActiveWitnesses = (witnessArray: Witness[]) => {
  const now = Date.now();
  return witnessArray.filter(w => w.expiresAt > now);
};

// Helper to get current store value
function get<T>(store: any): T {
  let value: T;
  store.subscribe((v: T) => value = v)();
  return value!;
}

console.log('🚨 Emergency witnessStore loaded - ready for rescue mission');