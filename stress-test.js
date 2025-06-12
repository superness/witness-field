#!/usr/bin/env node

/**
 * Witness Field Stress Test - 100 Agent Simulation
 * 
 * This script simulates 100 concurrent users creating witnesses, 
 * re-witnessing existing content, and having conversations in context.
 */

import Gun from 'gun';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultValue;
};

// Configuration
const AGENT_COUNT = parseInt(getArg('agents', '100'));
const TEST_DURATION = parseInt(getArg('duration', '300')) * 1000; // Convert seconds to milliseconds
const MIN_ACTION_INTERVAL = 500; // 0.5 seconds - much more aggressive
const MAX_ACTION_INTERVAL = 3000; // 3 seconds

// Connect to the same relay as the app
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

// Track Gun.js connection status
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

const APP_NAMESPACE = 'witness-field-collective-public-v3';
const fieldNode = gun.get(APP_NAMESPACE);

// Sample conversation topics and responses
const TOPICS = [
  'the morning light filtering through windows',
  'coffee steam rising in quiet kitchens',
  'footsteps echoing in empty hallways',
  'the weight of unspoken words',
  'shadows dancing on bedroom walls',
  'the sound of rain on rooftops',
  'distant laughter from another room',
  'the smell of old books',
  'forgotten dreams surfacing',
  'the pause between heartbeats',
  'streetlights flickering at dawn',
  'the taste of midnight air',
  'memories floating like dust motes',
  'the silence after the storm',
  'fingers tracing window condensation'
];

const CONTEXT_RESPONSES = [
  'yes, and the way it makes everything golden',
  'I felt this too, just yesterday',
  'reminds me of childhood summers',
  'there\'s something sacred in these moments',
  'the quiet holds so much',
  'I want to remember this feeling',
  'time moves differently here',
  'the ordinary becomes luminous',
  'breathing in this stillness',
  'finding peace in small things',
  'the world pauses for these instants',
  'beauty hiding in plain sight',
  'these fragments matter most',
  'holding this close to my heart',
  'the gentle weight of being present'
];

// Utilities
const randomChoice = (array) => array[Math.floor(Math.random() * array.length)];
const randomDelay = (min, max) => Math.random() * (max - min) + min;
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

// Proof of work matching witnessStore.ts algorithm
const computeProofOfWork = async (text) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const targetTime = 200; // Reduced from 1000ms for faster stress testing
    let nonce = 0;
    
    const compute = () => {
      const batchStart = Date.now();
      
      // Process in small batches to avoid blocking
      for (let i = 0; i < 1000 && (Date.now() - batchStart) < 10; i++) {
        const data = text + nonce;
        let hash = 0;
        
        // Basic hash (same as witnessStore.ts)
        for (let j = 0; j < data.length; j++) {
          hash = ((hash << 5) - hash + data.charCodeAt(j)) & 0xffffffff;
        }
        
        // Additional computation work (matching witnessStore.ts) - 10,000 iterations
        for (let k = 0; k < 10000; k++) {
          hash = (hash * 1103515245 + 12345) & 0xffffffff;
        }
        
        // Check if we've met the time target (before incrementing nonce)
        if (Date.now() - startTime >= targetTime) {
          resolve({ nonce, hash: hash.toString(16) });
          return;
        }
        
        nonce++;
      }
      
      // Continue in next tick to avoid blocking
      setTimeout(compute, 0);
    };
    
    compute();
  });
};

// Agent class to simulate user behavior
class WitnessAgent {
  constructor(id) {
    this.id = id;
    this.name = `Agent${id}`;
    this.isActive = true;
    this.knownWitnesses = new Map();
    this.conversationContext = null;
    this.actionCount = 0;
    
    console.log(`🤖 ${this.name} initialized`);
    this.listenForWitnesses();
    this.startBehaviorLoop();
    
    // Force first action quickly for testing
    setTimeout(() => {
      if (this.actionCount === 0) {
        console.log(`⚡ ${this.name} forcing first action`);
        this.createWitness().catch(e => console.error(`❌ ${this.name} first action failed:`, e.message));
      }
    }, 2000 + Math.random() * 3000);
  }

  async listenForWitnesses() {
    // Listen for witnesses from the network
    fieldNode.map().on((data, key) => {
      if (!data || !data.id || key.includes('-v')) return;
      
      // Skip incomplete data
      if (!data.text || !data.createdAt || !data.expiresAt) return;
      
      const witness = {
        id: data.id,
        text: data.text,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        witnessCount: data.witnessCount || 1,
        lastWitnessed: data.lastWitnessed || data.createdAt,
        contextOf: data.contextOf || null
      };

      // Only track active witnesses
      if (witness.expiresAt > Date.now()) {
        this.knownWitnesses.set(witness.id, witness);
      }
    });
  }

  startBehaviorLoop() {
    // Start with a small delay to stagger agents
    const initialDelay = Math.random() * 1000; // 0-1 second
    setTimeout(() => {
      this.runActions();
    }, initialDelay);
  }

  async runActions() {
    while (this.isActive) {
      try {
        await this.performRandomAction();
        const delay = randomDelay(MIN_ACTION_INTERVAL, MAX_ACTION_INTERVAL);
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        console.error(`❌ ${this.name} error:`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async performRandomAction() {
    const actions = ['createWitness', 'reWitness', 'respondInContext'];
    const weights = [0.4, 0.3, 0.3]; // 40% new, 30% re-witness, 30% context
    
    // Adjust weights based on available witnesses
    const activeWitnesses = Array.from(this.knownWitnesses.values())
      .filter(w => w.expiresAt > Date.now());
    
    if (activeWitnesses.length === 0) {
      // No witnesses available, must create
      await this.createWitness();
      return;
    }

    // Weighted random selection
    const rand = Math.random();
    let cumulativeWeight = 0;
    
    for (let i = 0; i < actions.length; i++) {
      cumulativeWeight += weights[i];
      if (rand <= cumulativeWeight) {
        await this[actions[i]]();
        break;
      }
    }
  }

  async createWitness() {
    try {
      console.log(`📝 ${this.name} starting to create witness...`);
      const text = randomChoice(TOPICS);
      console.log(`🎯 ${this.name} selected topic: "${text}"`);
      
      const proof = await computeProofOfWork(text.trim());
      console.log(`⚡ ${this.name} computed proof of work:`, proof);
      
      const now = Date.now();
      const witness = {
        id: generateId(),
        text: text.trim(),
        createdAt: now,
        expiresAt: now + (30 * 60 * 1000), // 30 minutes for testing
        witnessCount: 1,
        lastWitnessed: now,
        contextOf: this.conversationContext,
        proofNonce: proof.nonce,
        proofHash: proof.hash,
        entropySeed: Math.random(),
        contextTag: this.conversationContext ? 
          this.knownWitnesses.get(this.conversationContext)?.text : null,
        positionX: 5 + Math.random() * 90, // 5-95% of field (spread out)
        positionY: 5 + Math.random() * 90
      };

      console.log(`💾 ${this.name} putting witness to Gun.js:`, witness.id);
      const witnessNode = fieldNode.get(witness.id);
      
      // Just put the data without waiting for acknowledgment (Gun.js can be unreliable with acks)
      witnessNode.put(witness);
      
      this.knownWitnesses.set(witness.id, witness);
      this.actionCount++;
      
      console.log(`✨ ${this.name} created witness: "${text.substring(0, 30)}..." (${this.actionCount} actions)`);
      
      // Sometimes set this as new conversation context
      if (Math.random() < 0.3) {
        this.conversationContext = witness.id;
      }
      
      return witness;
    } catch (error) {
      console.error(`❌ ${this.name} failed to create witness:`, error.message, error.stack);
      throw error;
    }
  }

  async reWitness() {
    const activeWitnesses = Array.from(this.knownWitnesses.values())
      .filter(w => w.expiresAt > Date.now());
    
    if (activeWitnesses.length === 0) return;
    
    const targetWitness = randomChoice(activeWitnesses);
    const validationData = `rewitness:${targetWitness.id}:${Date.now()}`;
    const proof = await computeProofOfWork(validationData);
    
    try {
      const now = Date.now();
      const newWitnessCount = targetWitness.witnessCount + 1;
      const newExpiresAt = now + ((5 * 60 * 1000) + (newWitnessCount * 15 * 1000)); // 5min base + 15sec per witness
      
      const updatedWitness = {
        ...targetWitness,
        witnessCount: newWitnessCount,
        lastWitnessed: now,
        expiresAt: newExpiresAt,
        lastUpdate: now,
        updateSeq: newWitnessCount
      };

      const witnessNode = fieldNode.get(targetWitness.id);
      await witnessNode.put(updatedWitness);
      
      // Create versioned copy
      const versionedKey = `${targetWitness.id}-v${newWitnessCount}`;
      await fieldNode.get(versionedKey).put(updatedWitness);
      
      this.knownWitnesses.set(targetWitness.id, updatedWitness);
      this.actionCount++;
      
      console.log(`👁️  ${this.name} re-witnessed: "${targetWitness.text.substring(0, 30)}..." (count: ${newWitnessCount}) (${this.actionCount} actions)`);
      
      // Set as conversation context
      this.conversationContext = targetWitness.id;
    } catch (error) {
      console.error(`❌ ${this.name} failed to re-witness:`, error.message);
    }
  }

  async respondInContext() {
    const activeWitnesses = Array.from(this.knownWitnesses.values())
      .filter(w => w.expiresAt > Date.now());
    
    if (activeWitnesses.length === 0) return;
    
    const contextWitness = randomChoice(activeWitnesses);
    const responseText = randomChoice(CONTEXT_RESPONSES);
    const proof = await computeProofOfWork(responseText.trim());
    
    const now = Date.now();
    const witness = {
      id: generateId(),
      text: responseText.trim(),
      createdAt: now,
      expiresAt: now + (30 * 60 * 1000), // 30 minutes for testing
      witnessCount: 1,
      lastWitnessed: now,
      contextOf: contextWitness.id,
      proofNonce: proof.nonce,
      proofHash: proof.hash,
      entropySeed: Math.random(),
      contextTag: contextWitness.text,
      // Position near the context witness with larger drift to prevent clustering
      positionX: Math.max(5, Math.min(95, 
        (contextWitness.positionX || 50) + (Math.random() - 0.5) * 40 // Increased drift
      )),
      positionY: Math.max(5, Math.min(95, 
        (contextWitness.positionY || 50) + (Math.random() - 0.5) * 40
      ))
    };

    try {
      const witnessNode = fieldNode.get(witness.id);
      await witnessNode.put(witness);
      
      this.knownWitnesses.set(witness.id, witness);
      this.actionCount++;
      
      console.log(`💬 ${this.name} responded in context: "${responseText.substring(0, 30)}..." -> "${contextWitness.text.substring(0, 20)}..." (${this.actionCount} actions)`);
      
      this.conversationContext = witness.id;
    } catch (error) {
      console.error(`❌ ${this.name} failed to respond in context:`, error.message);
    }
  }

  stop() {
    this.isActive = false;
    console.log(`🛑 ${this.name} stopped after ${this.actionCount} actions`);
  }
}

// Main stress test execution
async function runStressTest() {
  console.log(`🚀 Starting Witness Field Stress Test`);
  console.log(`📊 Agents: ${AGENT_COUNT}`);
  console.log(`⏱️  Duration: ${TEST_DURATION / 1000} seconds`);
  console.log(`🎯 Target: ${APP_NAMESPACE}`);
  console.log(`🔗 Relay: the-witness-field-production.up.railway.app`);
  console.log(`🌐 Production Site: https://www.thewitnessfield.com`);
  console.log(`─────────────────────────────────────────────────────\n`);

  // Create all agents
  const agents = [];
  for (let i = 1; i <= AGENT_COUNT; i++) {
    agents.push(new WitnessAgent(i));
    // Stagger agent creation to avoid overwhelming the system
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`📈 Created ${i}/${AGENT_COUNT} agents`);
    }
  }

  console.log(`\n✅ All ${AGENT_COUNT} agents created and active!\n`);

  // Run for specified duration
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION));

  // Stop all agents
  console.log(`\n🏁 Test duration complete. Stopping all agents...`);
  agents.forEach(agent => agent.stop());

  // Show final stats
  const totalActions = agents.reduce((sum, agent) => sum + agent.actionCount, 0);
  const avgActionsPerAgent = totalActions / AGENT_COUNT;
  
  console.log(`\n📊 Final Statistics:`);
  console.log(`   Total Actions: ${totalActions}`);
  console.log(`   Avg Actions/Agent: ${avgActionsPerAgent.toFixed(1)}`);
  console.log(`   Actions/Second: ${(totalActions / (TEST_DURATION / 1000)).toFixed(2)}`);
  console.log(`\n🎉 Stress test completed!`);
  
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Start the stress test
runStressTest().catch(error => {
  console.error('💥 Stress test failed:', error);
  process.exit(1);
});