#!/usr/bin/env node

/**
 * Browser Verification Script
 * 
 * This script simulates what the browser sees by:
 * 1. Connecting to Gun.js like the browser does
 * 2. Loading witnesses from the namespace
 * 3. Running the same validation logic as the browser
 * 4. Reporting exactly what passes/fails and why
 */

import Gun from 'gun';

// Same Gun.js setup as browser
const gun = Gun({
  peers: [
    'https://the-witness-field-production.up.railway.app/gun',
    'wss://the-witness-field-production.up.railway.app/gun'
  ],
  localStorage: false,
  radisk: false,
  retry: 1,
  timeout: 5000
});

const APP_NAMESPACE = 'witness-field-collective-public-v3';
const fieldNode = gun.get(APP_NAMESPACE);

console.log('🌐 Browser Verification Script');
console.log('📦 Namespace:', APP_NAMESPACE);
console.log('🔗 Checking what browser would see...');
console.log('─────────────────────────────────────────────────────\n');

// Gun.js connection tracking
let connectedPeers = 0;
gun.on('hi', (peer) => {
  if (peer && peer.url) {
    connectedPeers++;
    console.log('🟢 Connected to peer:', peer.url);
  }
});

gun.on('bye', (peer) => {
  if (peer && peer.url) {
    connectedPeers--;
    console.log('🔴 Disconnected from peer:', peer.url);
  }
});

// Exact verification function from witnessStore.ts
const verifyProofOfWork = (text, proof) => {
  if (!proof || !proof.nonce || !proof.hash) {
    console.log('   ❌ Missing proof data:', proof);
    return false;
  }
  
  const data = text + proof.nonce;
  let hash = 0;
  
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) & 0xffffffff;
  }
  
  for (let k = 0; k < 10000; k++) {
    hash = (hash * 1103515245 + 12345) & 0xffffffff;
  }
  
  const calculatedHash = hash.toString(16);
  const isValid = calculatedHash === proof.hash;
  
  console.log('   🔍 PoW Details:');
  console.log('      Text:', text);
  console.log('      Nonce:', proof.nonce);
  console.log('      Expected hash:', proof.hash);
  console.log('      Calculated hash:', calculatedHash);
  console.log('      Valid:', isValid);
  
  return isValid;
};

// Exact witness reconstruction logic from witnessStore.ts
const processWitnessData = (data, key) => {
  console.log('\n📥 Processing witness data:');
  console.log('   Key:', key);
  console.log('   Raw data keys:', Object.keys(data));
  
  // Skip invalid data formats
  if (!data || !data.id || key.includes('-v')) {
    console.log('   ⏭️  Skipping: Invalid format or versioned key');
    return null;
  }
  
  // Check required fields
  if (!data.text || !data.createdAt || !data.expiresAt) {
    console.log('   ❌ Missing required fields:');
    console.log('      text:', !!data.text);
    console.log('      createdAt:', !!data.createdAt);
    console.log('      expiresAt:', !!data.expiresAt);
    return null;
  }
  
  // Reconstruct witness object like the browser does
  const witness = {
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
    entropySeed: data.entropySeed || Math.random(),
    contextTag: data.contextTag || null,
    positionX: data.positionX || 50,
    positionY: data.positionY || 50
  };
  
  console.log('   ✅ Reconstructed witness:');
  console.log('      ID:', witness.id);
  console.log('      Text:', witness.text);
  console.log('      Created:', new Date(witness.createdAt).toISOString());
  console.log('      Expires:', new Date(witness.expiresAt).toISOString());
  console.log('      Has proof:', !!witness.proof);
  
  // Check expiration (like browser does)
  const now = Date.now();
  if (witness.expiresAt <= now) {
    console.log('   ⏰ EXPIRED: Witness expired', ((now - witness.expiresAt) / 1000).toFixed(1), 'seconds ago');
    return null;
  }
  
  console.log('   ⏰ Active: Expires in', ((witness.expiresAt - now) / 1000).toFixed(1), 'seconds');
  
  // Verify PoW (like browser does)
  if (witness.proof) {
    const isValid = verifyProofOfWork(witness.text.trim(), witness.proof);
    if (!isValid) {
      console.log('   ❌ REJECTED: Invalid PoW');
      return null;
    }
    console.log('   ✅ ACCEPTED: Valid PoW');
  } else {
    console.log('   ⚠️  No proof data found');
  }
  
  console.log('   🎉 FINAL RESULT: Witness would be DISPLAYED in browser');
  return witness;
};

// Statistics tracking
let totalProcessed = 0;
let validWitnesses = 0;
let startTime = Date.now();

function showStats() {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n📊 Statistics after', elapsed.toFixed(1), 'seconds:');
  console.log('   Total processed:', totalProcessed);
  console.log('   Valid witnesses:', validWitnesses);
  console.log('   Connected peers:', connectedPeers);
  console.log('   ─────────────────────────────────────────────');
}

// Listen for all witnesses like the browser does
console.log('👂 Listening for witnesses...');
fieldNode.map().on((data, key) => {
  totalProcessed++;
  
  const witness = processWitnessData(data, key);
  if (witness) {
    validWitnesses++;
  }
  
  // Show periodic stats
  if (totalProcessed % 5 === 0) {
    showStats();
  }
});

// Show stats every 10 seconds
setInterval(showStats, 10000);

// Initial stats after connection
setTimeout(() => {
  showStats();
  if (totalProcessed === 0) {
    console.log('\n🔍 No witnesses found yet. This could mean:');
    console.log('   1. No witnesses exist in this namespace');
    console.log('   2. Connection issues with Gun.js relays');
    console.log('   3. Network propagation delays');
    console.log('\n💡 Try running the verify-witness.js script first');
  }
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Final statistics:');
  showStats();
  process.exit(0);
});