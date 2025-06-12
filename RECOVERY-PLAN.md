# Witness Field Recovery Plan

## Immediate Actions (Stop the Bleeding)

### 1. Emergency Fix for Production
Create a minimal working version that:
- Disables localStorage completely
- Uses Gun.js relay only (no browser storage)
- Aggressive 2-minute witness expiration
- No versioned witnesses
- Maximum 100 witnesses in memory

### 2. Clear Communication
- Add a notice: "Experiencing sync issues - refresh if needed"
- Document known issues
- Set expectations about persistence

## Short-Term Fix (1-2 days)

### Phase 1: Strip Down Gun.js Usage
```javascript
// FROM: Gun.js stores everything
fieldNode.get(witness.id).put(fullWitnessObject);

// TO: Gun.js stores minimal pointer
fieldNode.get('active').get(witness.id).put({
  id: witness.id,
  expiresAt: Date.now() + 120000 // 2 min
});
```

### Phase 2: Implement Proper Cleanup
- Remove ALL versioned witness code
- Delete witnesses from Gun after expiration
- Clear Gun.js data older than 1 hour
- No localStorage usage at all

### Phase 3: Simplify Features
- Remove witness count decay
- Cap witness counts at 10 max
- Reduce expiration to 2 minutes
- Limit field to 50 witnesses total

## Medium-Term Fix (1 week)

### Implement Hybrid Architecture
1. **Gun.js** - ONLY for peer discovery
2. **WebRTC** - For witness data exchange
3. **Memory** - For witness storage

```javascript
// Peer discovery only
gun.get('peers').get(myId).put({
  id: myId,
  timestamp: Date.now()
});

// Witness data over WebRTC
peerConnection.sendWitness({
  id, text, position, createdAt
});

// Memory storage only
const witnesses = new Map(); // No persistence
```

## Long-Term Solution (2 weeks)

### Complete Architectural Rebuild

#### Core Principles:
1. **No persistent storage** for witness data
2. **Peer discovery** separate from data exchange
3. **Memory-only** witness storage
4. **Direct peer connections** via WebRTC

#### Technology Stack:
```
- PeerJS or simple-peer (WebRTC abstraction)
- Custom signaling server (100 lines of code)
- In-memory witness store
- No Gun.js, no localStorage
```

#### Data Flow:
```
1. Browser A connects to signaling server
2. Gets list of active peers
3. Establishes WebRTC connections
4. Exchanges witnesses directly
5. Witnesses expire from memory
6. No persistence anywhere
```

## Decision Points

### Critical Questions to Answer:

1. **How important is true decentralization?**
   - If critical: Must rebuild with proper P2P
   - If not: Can use semi-centralized quick fix

2. **How important is offline capability?**
   - If critical: Need some localStorage (with strict limits)
   - If not: Memory-only is simpler

3. **Expected scale?**
   - <100 concurrent users: Current approach might work with fixes
   - >100 users: Need proper P2P architecture

4. **Development resources?**
   - Quick fix: 1-2 days (disable localStorage, reduce features)
   - Proper fix: 1-2 weeks (rebuild architecture)

## Recommended Path Forward

### Step 1: Emergency Production Fix (TODAY)
```javascript
// witnessStore-emergency.ts
const gun = Gun({
  peers: ['relay'],
  localStorage: false, // CRITICAL
  radisk: false
});

// Aggressive limits
const MAX_WITNESSES = 50;
const EXPIRATION_TIME = 2 * 60 * 1000; // 2 minutes

// No versioning, no complex updates
```

### Step 2: User Communication
- Blog post explaining the issues
- Set expectations about persistence
- Explain the ephemeral philosophy

### Step 3: Evaluate Architecture
- Test WebRTC-only prototype
- Measure actual P2P requirements
- Decide on final architecture

### Step 4: Implement Chosen Solution
- Either: Stripped-down Gun.js (semi-centralized)
- Or: Proper P2P with WebRTC (fully decentralized)

## Success Metrics

1. **No localStorage errors**
2. **Page loads in <3 seconds**
3. **Witnesses sync across devices**
4. **Memory usage <50MB**
5. **Can handle 100+ active witnesses**

## Lessons Applied

1. **Use tools for their intended purpose**
2. **Ephemeral data needs ephemeral infrastructure**
3. **Test with realistic data volumes**
4. **Simpler is usually better**
5. **Understand the full stack before building**