#!/usr/bin/env node

/**
 * Minimal Witness Verification Script
 * 
 * This script:
 * 1. Creates ONE witness with proper PoW
 * 2. Writes it to Gun.js
 * 3. Immediately reads it back to verify
 * 4. Provides detailed logging for debugging
 */

import Gun from 'gun';

// Same configuration as the app
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

console.log('🚀 Starting witness verification test');
console.log('📦 Namespace:', APP_NAMESPACE);
console.log('🔗 Relay: the-witness-field-production.up.railway.app');
console.log('─────────────────────────────────────────────────────\n');

// Track Gun.js connection
let gunConnected = false;
gun.on('hi', (peer) => {
  if (peer && peer.url) {
    console.log('🟢 Gun.js connected to:', peer.url);
    gunConnected = true;
  } else {
    console.log('💾 Gun.js localStorage ready');
  }
});

gun.on('bye', (peer) => {
  if (peer && peer.url) {
    console.log('🔴 Gun.js disconnected from:', peer.url);
  }
});

// Exact PoW algorithm from witnessStore.ts
const computeProofOfWork = async (text) => {
  console.log('⚡ Starting PoW computation for text:', text);
  return new Promise((resolve) => {
    const startTime = Date.now();
    const targetTime = 1000; // Same as main app
    let nonce = 0;
    
    const compute = () => {
      const batchStart = Date.now();
      
      for (let i = 0; i < 1000 && (Date.now() - batchStart) < 10; i++) {
        const data = text + nonce;
        let hash = 0;
        
        // Basic hash
        for (let j = 0; j < data.length; j++) {
          hash = ((hash << 5) - hash + data.charCodeAt(j)) & 0xffffffff;
        }
        
        // Additional computation work (critical!) - 10,000 iterations like witnessStore.ts
        for (let k = 0; k < 10000; k++) {
          hash = (hash * 1103515245 + 12345) & 0xffffffff;
        }
        
        if (Date.now() - startTime >= targetTime) {
          // Convert to unsigned 32-bit hex representation like witnessStore.ts
          const hashHex = (hash >>> 0).toString(16);
          const result = { nonce, hash: hashHex };
          console.log('✅ PoW completed:', result, 'in', (Date.now() - startTime) + 'ms');
          console.log('   Final data string during generation:', JSON.stringify(data));
          console.log('   Final hash value during generation:', hash);
          console.log('   Final hashHex during generation:', hashHex);
          resolve(result);
          return;
        }
        
        nonce++;
      }
      
      setTimeout(compute, 0);
    };
    
    compute();
  });
};

// Verification function (same as witnessStore.ts)
const verifyProofOfWork = (text, proof) => {
  if (!proof || !proof.nonce || !proof.hash) return false;
  
  console.log('🔍 Verifying PoW:');
  console.log('   text:', JSON.stringify(text));
  console.log('   nonce:', proof.nonce);
  console.log('   expected hash:', proof.hash);
  
  const data = text + proof.nonce;
  console.log('   data string:', JSON.stringify(data));
  
  let hash = 0;
  
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) & 0xffffffff;
  }
  console.log('   hash after basic computation:', hash);
  
  for (let k = 0; k < 10000; k++) {
    hash = (hash * 1103515245 + 12345) & 0xffffffff;
  }
  
  const calculatedHash = (hash >>> 0).toString(16);
  console.log('   calculated hash:', calculatedHash);
  
  const isValid = calculatedHash === proof.hash;
  console.log('   is valid:', isValid);
  
  return isValid;
};

const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

async function createAndVerifyWitness() {
  const testText = 'This is a test witness for verification';
  console.log('\n📝 Creating witness with text:', testText);
  
  try {
    // Step 1: Compute PoW
    const proof = await computeProofOfWork(testText.trim());
    
    // Step 2: Verify our own PoW immediately
    const isValidLocal = verifyProofOfWork(testText.trim(), proof);
    console.log('🔍 Local PoW verification:', isValidLocal);
    
    if (!isValidLocal) {
      console.error('❌ CRITICAL: Our own PoW failed verification!');
      process.exit(1);
    }
    
    // Step 3: Create witness object
    const now = Date.now();
    const witnessId = generateId();
    const witness = {
      id: witnessId,
      text: testText.trim(),
      createdAt: now,
      expiresAt: now + (10 * 60 * 1000), // 10 minutes
      witnessCount: 1,
      lastWitnessed: now,
      contextOf: null,
      proofNonce: proof.nonce,
      proofHash: proof.hash,
      entropySeed: Math.random(),
      contextTag: null,
      positionX: 50,
      positionY: 50
    };
    
    console.log('\n💾 Writing witness to Gun.js:');
    console.log('   ID:', witnessId);
    console.log('   Text:', testText);
    console.log('   Proof:', proof);
    console.log('   Expires:', new Date(witness.expiresAt).toISOString());
    
    // Step 4: Write to Gun.js
    const witnessNode = fieldNode.get(witnessId);
    witnessNode.put(witness);
    
    console.log('✅ Witness written to Gun.js');
    
    // Step 5: Wait and then read it back
    console.log('\n⏳ Waiting 3 seconds then reading back...');
    
    setTimeout(() => {
      console.log('📖 Reading witness back from Gun.js...');
      
      witnessNode.once((data, key) => {
        console.log('\n📨 Received data from Gun.js:');
        console.log('   Key:', key);
        console.log('   Data:', JSON.stringify(data, null, 2));
        
        if (!data) {
          console.error('❌ No data received!');
          process.exit(1);
        }
        
        // Reconstruct proof object like the app does
        const reconstructedProof = data.proofNonce && data.proofHash ? {
          nonce: data.proofNonce,
          hash: data.proofHash
        } : undefined;
        
        console.log('🔄 Reconstructed proof:', reconstructedProof);
        
        // Verify the reconstructed proof
        if (reconstructedProof) {
          const isValidReconstructed = verifyProofOfWork(data.text.trim(), reconstructedProof);
          console.log('🔍 Reconstructed PoW verification:', isValidReconstructed);
          
          if (isValidReconstructed) {
            console.log('✅ SUCCESS: Witness created and verified successfully!');
            console.log('🌐 Browser should now be able to see this witness.');
          } else {
            console.log('❌ FAILURE: Reconstructed proof failed verification');
            console.log('   Original proof:', proof);
            console.log('   Reconstructed:', reconstructedProof);
          }
        } else {
          console.log('❌ FAILURE: No proof data in retrieved witness');
        }
        
        process.exit(0);
      });
      
      // Also listen for all witnesses in the namespace
      console.log('👂 Also listening for all witnesses in namespace...');
      fieldNode.map().on((data, key) => {
        if (data && data.id === witnessId) {
          console.log('📡 Detected our witness via .map():', key, data.text?.substring(0, 30) + '...');
        }
      });
      
    }, 3000);
    
  } catch (error) {
    console.error('💥 Error creating witness:', error);
    process.exit(1);
  }
}

// Wait for connection then create witness
setTimeout(() => {
  console.log('🎯 Starting witness creation...');
  createAndVerifyWitness();
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});