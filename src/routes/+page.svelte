<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { witnesses, addWitness, reWitness, initializeStore, getActiveWitnesses, connectionStatus } from '../lib/witnessStore-emergency.js';
  import type { Witness } from '../lib/types.js';

  let witnessText = '';
  let isSubmitting = false;
  let contextWitnessId: string | null = null;
  let contextWitness: Witness | null = null;
  let showInput = false; // Track if input should be shown
  const maxLength = 140;

  // Field navigation state - start at field center (50%, 50%)
  let fieldOffset = { x: 0, y: 0 }; // Will be set to center in onMount
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let centeredWitness: string | null = null;
  let validationInterval: number | null = null;
  let isValidating = false; // Track when PoW is being computed for validation
  let validationCount = 0; // Track how many times we've validated
  let pulseKey = 0; // Trigger visual pulse animations
  let witnessUpdatePulses = new Map(); // Track which witnesses should pulse
  let showClusterPortal = false; // Show/hide cluster teleportation portal
  let witnessClusters = []; // Detected witness clusters for teleportation
  
  
  // Reasonable field size to reduce memory usage
  let fieldWidth = 4000;
  let fieldHeight = 4000;
  
  // Update field size on mount and resize
  const updateFieldSize = () => {
    if (typeof window !== 'undefined') {
      // Reasonable size to reduce memory usage
      fieldWidth = Math.max(4000, window.innerWidth * 2);
      fieldHeight = Math.max(4000, window.innerHeight * 2);
    }
  };

  $: remainingChars = maxLength - witnessText.length;
  $: canSubmit = witnessText.trim().length > 0 && witnessText.length <= maxLength;
  $: activeWitnesses = getActiveWitnesses($witnesses);
  
  // Detect witness clusters for teleportation
  $: witnessClusters = detectWitnessClusters(activeWitnesses);
  
  // Track witness count changes to trigger pulse animations (only for INCREASES)
  let previousWitnessCounts = new Map();
  const MAX_PULSE_TRACKING = 200; // Limit size of tracking map
  $: {
    $witnesses.forEach(witness => {
      const prevCount = previousWitnessCounts.get(witness.id);
      if (prevCount !== undefined && witness.witnessCount > prevCount) {
        // Witness count INCREASED, trigger positive pulse
        witnessUpdatePulses.set(witness.id, Date.now());
        console.log('📈 Witness count increased:', witness.id, prevCount, '->', witness.witnessCount);
        // Remove pulse after animation duration
        setTimeout(() => {
          witnessUpdatePulses.delete(witness.id);
          witnessUpdatePulses = new Map(witnessUpdatePulses); // Trigger reactivity
        }, 600);
      } else if (prevCount !== undefined && witness.witnessCount < prevCount) {
        // Witness count decreased (entropy decay) - just log, no pulse
        console.log('📉 Witness count decayed:', witness.id, prevCount, '->', witness.witnessCount);
      }
      previousWitnessCounts.set(witness.id, witness.witnessCount);
    });
    
    // Clean up old entries
    const currentIds = new Set($witnesses.map(w => w.id));
    for (const id of previousWitnessCounts.keys()) {
      if (!currentIds.has(id)) {
        previousWitnessCounts.delete(id);
      }
    }
    // Limit map size
    if (previousWitnessCounts.size > MAX_PULSE_TRACKING) {
      const entriesToRemove = previousWitnessCounts.size - MAX_PULSE_TRACKING;
      const keysToRemove = Array.from(previousWitnessCounts.keys()).slice(0, entriesToRemove);
      keysToRemove.forEach(key => previousWitnessCounts.delete(key));
    }
  }
  
  // Debug mode based on URL params
  let debugMode = false;
  onMount(() => {
    debugMode = new URLSearchParams(window.location.search).has('debug');
  });
  
  $: if (debugMode) console.log('Total witnesses:', $witnesses.length, 'Active witnesses:', activeWitnesses.length);

  // Enhanced debug information
  $: debugStats = debugMode ? {
    totalWitnesses: $witnesses.length,
    activeWitnesses: activeWitnesses.length,
    expiredWitnesses: $witnesses.length - activeWitnesses.length,
    connectionStatus: $connectionStatus,
    currentViewport: {
      centerX: ((-fieldOffset.x + window.innerWidth / 2) / fieldWidth * 100).toFixed(1),
      centerY: ((-fieldOffset.y + window.innerHeight / 2) / fieldHeight * 100).toFixed(1)
    },
    fieldSize: { width: fieldWidth, height: fieldHeight },
    clusters: witnessClusters.length,
    testWitnesses: activeWitnesses.filter(w => w.text.startsWith('SYNC_TEST_')).length,
    lastRefresh: new Date().toISOString(),
    loadTime: Date.now()
  } : null;

  // Get witness position relative to current viewport
  const getWitnessViewportInfo = (witness: Witness) => {
    if (!witness.metadata.position) return null;
    
    const witnessX = (witness.metadata.position.x / 100) * fieldWidth;
    const witnessY = (witness.metadata.position.y / 100) * fieldHeight;
    
    const screenX = witnessX + fieldOffset.x;
    const screenY = witnessY + fieldOffset.y;
    
    const isVisible = screenX >= -100 && screenX <= window.innerWidth + 100 && 
                      screenY >= -100 && screenY <= window.innerHeight + 100;
    
    const distance = Math.sqrt(
      Math.pow((-fieldOffset.x + window.innerWidth / 2) - witnessX, 2) +
      Math.pow((-fieldOffset.y + window.innerHeight / 2) - witnessY, 2)
    );
    
    return {
      screenX: screenX.toFixed(0),
      screenY: screenY.toFixed(0),
      fieldX: witness.metadata.position.x.toFixed(1),
      fieldY: witness.metadata.position.y.toFixed(1),
      distance: distance.toFixed(0),
      isVisible,
      direction: getDirectionTo(witnessX, witnessY)
    };
  };

  // Get direction arrow to witness
  const getDirectionTo = (targetX: number, targetY: number) => {
    const viewportCenterX = -fieldOffset.x + window.innerWidth / 2;
    const viewportCenterY = -fieldOffset.y + window.innerHeight / 2;
    
    const dx = targetX - viewportCenterX;
    const dy = targetY - viewportCenterY;
    
    const angle = Math.atan2(dy, dx);
    const degrees = (angle * 180 / Math.PI + 360) % 360;
    
    if (degrees < 22.5 || degrees >= 337.5) return '→';
    if (degrees < 67.5) return '↘';
    if (degrees < 112.5) return '↓';
    if (degrees < 157.5) return '↙';
    if (degrees < 202.5) return '←';
    if (degrees < 247.5) return '↖';
    if (degrees < 292.5) return '↑';
    return '↗';
  };

  // Jump to specific witness
  const jumpToWitness = (witness: Witness) => {
    centerWitness(witness);
    console.log('🎯 Debug: Jumped to witness:', witness.text.substring(0, 50) + '...');
  };

  // Detect witness clusters using spatial grouping
  const detectWitnessClusters = (witnesses: Witness[]) => {
    if (witnesses.length === 0) return [];
    
    const clusters: Array<{
      id: string;
      witnesses: Witness[];
      center: { x: number; y: number };
      size: number;
    }> = [];
    const visited = new Set<string>();
    const clusterRadius = 25; // % - witnesses within 25% distance are in same cluster
    
    witnesses.forEach(witness => {
      if (!witness.metadata.position || visited.has(witness.id)) return;
      
      // Start new cluster
      const cluster = {
        id: `cluster_${clusters.length}`,
        witnesses: [witness],
        center: { x: witness.metadata.position.x, y: witness.metadata.position.y },
        size: 1
      };
      
      visited.add(witness.id);
      
      // Find all nearby witnesses for this cluster
      witnesses.forEach(otherWitness => {
        if (!otherWitness.metadata.position || visited.has(otherWitness.id)) return;
        
        if (!witness.metadata.position || !otherWitness.metadata.position) return;
        const distance = Math.sqrt(
          Math.pow(witness.metadata.position.x - otherWitness.metadata.position.x, 2) +
          Math.pow(witness.metadata.position.y - otherWitness.metadata.position.y, 2)
        );
        
        if (distance <= clusterRadius) {
          cluster.witnesses.push(otherWitness);
          visited.add(otherWitness.id);
          cluster.size++;
        }
      });
      
      // Calculate cluster center
      const centerX = cluster.witnesses.reduce((sum, w) => sum + (w.metadata.position?.x || 0), 0) / cluster.size;
      const centerY = cluster.witnesses.reduce((sum, w) => sum + (w.metadata.position?.y || 0), 0) / cluster.size;
      cluster.center = { x: centerX, y: centerY };
      
      // Only add clusters with 2+ witnesses
      if (cluster.size >= 2) {
        clusters.push(cluster);
      }
    });
    
    // Sort by size (largest first)
    return clusters.sort((a, b) => b.size - a.size);
  };

  const getClusterSummary = (cluster: { witnesses: Witness[]; size: number }) => {
    // Just show the primary witness text (truncated)
    const primaryWitness = cluster.witnesses[0];
    return `"${primaryWitness.text.substring(0, 30)}..."`;
  };

  // Teleport to a cluster
  const teleportToCluster = (cluster: { center: { x: number; y: number }; size: number }) => {
    console.log(`🌀 Teleporting to cluster with ${cluster.size} witnesses`);
    
    // Calculate field offset to center this cluster
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    
    const clusterX = (cluster.center.x / 100) * fieldWidth;
    const clusterY = (cluster.center.y / 100) * fieldHeight;
    
    fieldOffset = {
      x: viewportCenterX - clusterX,
      y: viewportCenterY - clusterY
    };
    
    // Apply constraints to keep field navigable
    fieldOffset = constrainFieldOffset(fieldOffset);
    
    // Hide portal after teleport
    showClusterPortal = false;
    
    // Clear any centered witness
    centeredWitness = null;
    
    console.log(`📍 Teleported to cluster at ${cluster.center.x.toFixed(1)}%, ${cluster.center.y.toFixed(1)}%`);
  };

  // Physics-based drift system with memory management
  let witnessVelocities = new Map(); // Track velocity for each witness
  const MAX_VELOCITY_ENTRIES = 250; // Limit velocity map size
  
  onMount(() => {
    initializeStore();
    updateFieldSize();
    
    // Start centered at field center (50%, 50%) - ensure field size is set first
    setTimeout(() => {
      const centerX = (50 / 100) * fieldWidth;
      const centerY = (50 / 100) * fieldHeight;
      fieldOffset = {
        x: fieldWidth - (window.innerWidth / 2),
        y: fieldHeight - (window.innerHeight / 2)
      };
      console.log('🎯 Initial centering:', { fieldWidth, fieldHeight, centerX, centerY, fieldOffset });
    }, 100);
    
    
    // Add resize listener
    const handleResize = () => updateFieldSize();
    window.addEventListener('resize', handleResize);
    
    
    // Physics simulation for smooth drift
    const physicsInterval = setInterval(() => {
      witnesses.update(current => 
        current.map(witness => {
          if (!witness.metadata.position) return witness;
          
          // Get or create velocity for this witness
          let velocity = witnessVelocities.get(witness.id);
          if (!velocity) {
            velocity = { vx: 0, vy: 0 };
            witnessVelocities.set(witness.id, velocity);
          }
          
          // Apply repulsion force to prevent clustering (personal space)
          // Reduce physics calculations when field is crowded to prevent chaos
          const maxPhysicsCalculations = Math.min(activeWitnesses.length, 20); // Cap at 20 interactions per witness for better performance
          const nearbyWitnesses = activeWitnesses
            .filter(w => w.id !== witness.id && w.metadata.position)
            .sort((a, b) => {
              if (!a.metadata.position || !b.metadata.position || !witness.metadata.position) return 0;
              const distA = Math.sqrt(
                Math.pow(a.metadata.position.x - witness.metadata.position.x, 2) +
                Math.pow(a.metadata.position.y - witness.metadata.position.y, 2)
              );
              const distB = Math.sqrt(
                Math.pow(b.metadata.position.x - witness.metadata.position.x, 2) +
                Math.pow(b.metadata.position.y - witness.metadata.position.y, 2)
              );
              return distA - distB;
            })
            .slice(0, maxPhysicsCalculations); // Only calculate physics with closest witnesses
          
          nearbyWitnesses.forEach(otherWitness => {
            if (!otherWitness.metadata.position || !witness.metadata.position) return;
            const dx = otherWitness.metadata.position.x - witness.metadata.position.x;
            const dy = otherWitness.metadata.position.y - witness.metadata.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if these witnesses are connected (parent-child relationship)
            const areConnected = witness.contextOf === otherWitness.id || 
                                 otherWitness.contextOf === witness.id ||
                                 witness.contextOf === otherWitness.contextOf;
            
            // Different minimum distances for connected vs unconnected witnesses
            const minDistance = areConnected ? 2 : 4; // Much smaller distances in larger field
            
            if (distance < minDistance && distance > 0) {
              // Much gentler repulsion force to prevent explosions
              const crowdingFactor = Math.min(1, activeWitnesses.length / 100); // Reduce force when crowded
              const repulsionStrength = (minDistance - distance) * 0.0005 * (1 - crowdingFactor * 0.8);
              velocity.vx -= (dx / distance) * repulsionStrength;
              velocity.vy -= (dy / distance) * repulsionStrength;
            }
          });
          
          // Apply connection force to keep context witnesses near their parent
          if (witness.contextOf) {
            const parentWitness = activeWitnesses.find(w => w.id === witness.contextOf);
            if (parentWitness && parentWitness.metadata.position) {
              const dx = parentWitness.metadata.position.x - witness.metadata.position.x;
              const dy = parentWitness.metadata.position.y - witness.metadata.position.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              // Apply gentle pull force if drifting too far (>3% apart, matches smart placement)
              if (distance > 3) {
                const pullStrength = Math.min(0.01, (distance - 3) * 0.0008); // Even gentler pull
                velocity.vx += (dx / distance) * pullStrength;
                velocity.vy += (dy / distance) * pullStrength;
              }
            }
          }
          
          // Apply random force every few seconds (based on entropy seed) - very gentle
          const timeSeed = Date.now() / 20000 + (witness.metadata.entropySeed || 0) * 100;
          if (Math.sin(timeSeed) > 0.99) { // ~1% chance per frame (less frequent)
            const forceStrength = 0.002 + Math.random() * 0.005; // 0.002-0.007% per frame (very gentle)
            const forceAngle = Math.random() * Math.PI * 2;
            
            velocity.vx += Math.cos(forceAngle) * forceStrength;
            velocity.vy += Math.sin(forceAngle) * forceStrength;
          }
          
          // Apply drag/friction
          const friction = 0.99; // Higher friction = slower movement
          velocity.vx *= friction;
          velocity.vy *= friction;
          
          // Update position based on velocity - use full field area
          const newX = Math.max(2, Math.min(98, 
            witness.metadata.position.x + velocity.vx
          ));
          const newY = Math.max(2, Math.min(98, 
            witness.metadata.position.y + velocity.vy
          ));
          
          // Boundary collision - reverse velocity if hitting edges (gentler bounce)
          if (newX <= 2 || newX >= 98) velocity.vx *= -0.3;
          if (newY <= 2 || newY >= 98) velocity.vy *= -0.3;
          
          return {
            ...witness,
            metadata: {
              ...witness.metadata,
              position: { x: newX, y: newY }
            }
          };
        })
      );
    }, 150); // ~6.7 FPS to reduce CPU usage
    
    // Cleanup expired witness velocities
    const cleanupInterval = setInterval(() => {
      const currentIds = new Set($witnesses.map(w => w.id));
      for (const id of witnessVelocities.keys()) {
        if (!currentIds.has(id)) {
          witnessVelocities.delete(id);
        }
      }
      // Also limit the size of the velocity map
      if (witnessVelocities.size > MAX_VELOCITY_ENTRIES) {
        const entriesToRemove = witnessVelocities.size - MAX_VELOCITY_ENTRIES;
        const keysToRemove = Array.from(witnessVelocities.keys()).slice(0, entriesToRemove);
        keysToRemove.forEach(key => witnessVelocities.delete(key));
      }
    }, 10000); // Clean up every 10 seconds
    
    return () => {
      clearInterval(physicsInterval);
      clearInterval(cleanupInterval);
      window.removeEventListener('resize', handleResize);
    };
  });

  onDestroy(() => {
    // Clean up validation interval on component destroy
    if (validationInterval) {
      clearInterval(validationInterval);
    }
  });

  const submitWitness = async () => {
    if (!canSubmit || isSubmitting) return;
    
    isSubmitting = true;
    try {
      const newWitness = await addWitness(witnessText, contextWitnessId || undefined);
      witnessText = '';
      
      // Clear validation interval when submitting
      if (validationInterval) {
        clearInterval(validationInterval);
        validationInterval = null;
      }
      
      contextWitnessId = null;
      contextWitness = null;
      showInput = false; // Collapse interface after submission
      
      // Auto-select and center the new witness
      setTimeout(() => {
        startContextWitness(newWitness);
        centerWitness(newWitness);
      }, 100); // Small delay to ensure witness is rendered
      
    } catch (error) {
      console.error('Failed to submit witness:', error);
    } finally {
      isSubmitting = false;
    }
  };

  const startContextWitness = (witness: Witness) => {
    contextWitnessId = witness.id;
    contextWitness = witness;
    witnessText = '';
    
    // Clear any existing validation interval
    if (validationInterval) {
      clearInterval(validationInterval);
    }
    
    // Start automatic validation every 5 seconds (now with PoW)
    validationInterval = setInterval(async () => {
      if (contextWitnessId === witness.id && !isValidating) {
        console.log('Auto-validating focused witness (computing PoW):', witness.id);
        isValidating = true;
        try {
          await reWitness(witness.id);
          validationCount++;
          pulseKey++; // Trigger pulse animation
          
        } catch (error) {
          console.error('Auto-validation failed:', error);
        } finally {
          isValidating = false;
        }
      }
    }, 5000); // Every 5 seconds for responsive experience
    
    // Scroll input into view and focus
    const inputSection = document.querySelector('.input-overlay');
    if (inputSection) {
      inputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => {
      document.querySelector('textarea')?.focus();
    }, 300);
  };

  const cancelContext = () => {
    // Clear validation interval when canceling context
    if (validationInterval) {
      clearInterval(validationInterval);
      validationInterval = null;
    }
    
    contextWitnessId = null;
    contextWitness = null;
    validationCount = 0; // Reset validation count
    pulseKey = 0; // Reset pulse key
    showInput = false; // Collapse interface when canceling
  };

  const onWitnessInteract = (witness: Witness) => {
    // Clicking only selects for context - does NOT increase witness count
    console.log('Selecting witness:', witness.id, witness.text);
    startContextWitness(witness);
    centerWitness(witness);
  };

  const onWitnessClick = (event: MouseEvent, witness: Witness) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent field dragging
    onWitnessInteract(witness);
  };

  const onWitnessTouch = (event: TouchEvent, witness: Witness) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent field dragging
    onWitnessInteract(witness);
  };

  // Handle right-click context menu
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  const centerWitness = (witness: Witness) => {
    if (!witness.metadata.position) return;
    
    centeredWitness = witness.id;
    
    // Calculate offset to center this witness
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    
    // Convert witness percentage position to pixels in expanded field
    const witnessX = (witness.metadata.position.x / 100) * fieldWidth;
    const witnessY = (witness.metadata.position.y / 100) * fieldHeight;
    
    const desiredOffset = {
      x: viewportCenterX - witnessX,
      y: viewportCenterY - witnessY
    };
    
    // Apply bounds constraints
    fieldOffset = constrainFieldOffset(desiredOffset);
  };

  // Field dragging handlers - unified for mouse and touch
  const startDrag = (clientX: number, clientY: number) => {
    isDragging = true;
    dragStart = { x: clientX - fieldOffset.x, y: clientY - fieldOffset.y };
    centeredWitness = null; // Clear centering when dragging
    
    // Unselect witness when clicking on empty field
    cancelContext();
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (isDragging) {
      const newOffset = {
        x: clientX - dragStart.x,
        y: clientY - dragStart.y
      };
      
      // Apply bounds to keep witnesses visible
      fieldOffset = constrainFieldOffset(newOffset);
    }
  };

  const endDrag = () => {
    isDragging = false;
  };

  // Mouse event handlers
  const onFieldMouseDown = (event: MouseEvent) => {
    if (event.button === 0) { // Left mouse button
      startDrag(event.clientX, event.clientY);
    }
  };

  const onFieldMouseMove = (event: MouseEvent) => {
    updateDrag(event.clientX, event.clientY);
  };

  // Touch event handlers
  const onFieldTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1) {
      event.preventDefault(); // Prevent scrolling
      const touch = event.touches[0];
      startDrag(touch.clientX, touch.clientY);
    }
  };

  const onFieldTouchMove = (event: TouchEvent) => {
    if (event.touches.length === 1) {
      event.preventDefault(); // Prevent scrolling
      const touch = event.touches[0];
      updateDrag(touch.clientX, touch.clientY);
    }
  };

  const onFieldTouchEnd = (event: TouchEvent) => {
    event.preventDefault();
    endDrag();
  };

  const constrainFieldOffset = (offset: { x: number; y: number }) => {
    if (activeWitnesses.length === 0) return offset;
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Find the closest witness to the center of viewport
    let closestWitness = null;
    let closestDistance = Infinity;
    
    for (const witness of activeWitnesses) {
      if (!witness.metadata.position) continue;
      
      const witnessX = (witness.metadata.position.x / 100) * fieldWidth;
      const witnessY = (witness.metadata.position.y / 100) * fieldHeight;
      
      // Calculate where viewport center would be relative to this witness
      const viewportCenterX = -offset.x + viewportWidth / 2;
      const viewportCenterY = -offset.y + viewportHeight / 2;
      
      const distance = Math.sqrt(
        Math.pow(viewportCenterX - witnessX, 2) + 
        Math.pow(viewportCenterY - witnessY, 2)
      );
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestWitness = witness;
      }
    }
    
    if (!closestWitness) return offset;
    
    // Apply gradual resistance based on distance from closest witness
    const comfortZone = 200; // Distance where no resistance starts (smaller)
    const maxResistance = 400; // Distance where maximum resistance kicks in (smaller)
    
    if (closestDistance > comfortZone) {
      const resistanceRatio = Math.min(1, (closestDistance - comfortZone) / (maxResistance - comfortZone));
      
      // Calculate ideal position (centered on closest witness)
      const witnessX = (closestWitness.metadata.position!.x / 100) * fieldWidth;
      const witnessY = (closestWitness.metadata.position!.y / 100) * fieldHeight;
      const idealOffsetX = (viewportWidth / 2) - witnessX;
      const idealOffsetY = (viewportHeight / 2) - witnessY;
      
      // Much stronger resistance - up to 80% pull back per frame
      const resistanceStrength = resistanceRatio * 0.8;
      
      const constrainedOffset = {
        x: offset.x + (idealOffsetX - offset.x) * resistanceStrength,
        y: offset.y + (idealOffsetY - offset.y) * resistanceStrength
      };
      
      return constrainedOffset;
    }
    
    return offset;
  };

  const onFieldMouseUp = () => {
    endDrag();
  };


  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitWitness();
    }
  };

  const getAgeOpacity = (createdAt: number, expiresAt: number) => {
    const now = Date.now();
    const timeLeft = expiresAt - now;
    
    // More conservative opacity thresholds for longer-lived witnesses
    if (timeLeft < 15000) return Math.max(0.1, (timeLeft / 15000) * 0.5); // Last 15 seconds: fade to almost nothing
    if (timeLeft < 30000) return Math.max(0.4, (timeLeft / 30000) * 0.8); // Last 30 seconds: fade significantly
    return 1.0; // Full opacity if more than 30 seconds left
  };

  const getAgeClass = (createdAt: number, expiresAt: number) => {
    const now = Date.now();
    const timeLeft = expiresAt - now;
    
    // Much more conservative aging thresholds - only apply effects in final moments
    if (timeLeft < 15000) return 'dissipating'; // Last 15 seconds only
    if (timeLeft < 30000) return 'very-old'; // Last 30 seconds
    if (timeLeft < 45000) return 'aging'; // Last 45 seconds
    return ''; // No aging effects if more than 45 seconds left
  };

  const getWitnessStrength = (witness: Witness) => {
    // Visual indicator of collective validation
    if (witness.witnessCount === 1) return 'new';
    if (witness.witnessCount < 5) return 'noticed';
    if (witness.witnessCount < 10) return 'witnessed';
    return 'consensus';
  };

  const getTimeRemaining = (expiresAt: number) => {
    const timeLeft = expiresAt - Date.now();
    if (timeLeft <= 0) return '0s';
    
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

</script>

<svelte:head>
  <title>Witness Field</title>
  <meta name="description" content="An ambient space for anonymous, ephemeral witnessings" />
</svelte:head>

<main class="field-container">
  <!-- Fixed Input Overlay - Collapsible on Mobile -->
  <section class="input-overlay {contextWitness || witnessText || showInput ? 'expanded' : 'collapsed'}">
    {#if contextWitness || witnessText || showInput}
      <!-- Full input interface when active -->
      <div class="bg-white/90 backdrop-blur-sm rounded-lg p-6 shadow-sm border border-gray-100">
        
        {#if contextWitness}
          {#key pulseKey}
            <div class="mb-3 bg-indigo-50 border border-indigo-100 rounded-lg p-3 context-pulse">
              <div class="flex items-center justify-between text-xs text-indigo-600 mb-2">
                <span>focusing on this witness</span>
                <button on:click={cancelContext} class="hover:text-indigo-800 text-lg leading-none">×</button>
              </div>
              <div class="text-sm text-gray-700 italic border-l-2 border-indigo-200 pl-3">
                "{contextWitness.text}"
              </div>
              {#if contextWitness.metadata.contextTag}
                <div class="text-xs text-indigo-600 mt-2">exploring: <strong>{contextWitness.metadata.contextTag}</strong></div>
              {/if}
            </div>
          {/key}
        {/if}
        
        <div class="mb-4">
          <textarea
            bind:value={witnessText}
            on:keydown={handleKeydown}
            placeholder="witness something..."
            class="witness-input"
            rows="3"
            maxlength={maxLength}
            disabled={isSubmitting}
          ></textarea>
        </div>
        
        <div class="flex justify-between items-center">
          <span class="text-xs text-gray-400">
            {remainingChars} chars remaining
          </span>
          
          <button
            on:click={submitWitness}
            disabled={!canSubmit || isSubmitting}
            class="px-4 py-2 text-sm font-medium rounded-md transition-all duration-200
                   {canSubmit && !isSubmitting 
                     ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm' 
                     : 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
          >
            {isSubmitting ? 'manifesting...' : 'witness'}
          </button>
        </div>
      </div>
    {:else}
      <!-- Collapsed state - minimal instruction (clickable to expand) -->
      <div 
        class="bg-white/90 backdrop-blur-sm rounded-lg px-4 py-3 shadow-sm border border-gray-100 cursor-pointer hover:bg-white/95 transition-colors"
        on:click={() => {
          // Expand interface and focus textarea
          showInput = true;
          setTimeout(() => {
            document.querySelector('textarea')?.focus();
          }, 100);
        }}
        role="button"
        tabindex="0"
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            showInput = true;
            setTimeout(() => {
              document.querySelector('textarea')?.focus();
            }, 100);
          }
        }}
      >
        <div class="text-xs text-gray-500 text-center">
          tap any witness to witness in context • tap here to witness
        </div>
      </div>
    {/if}
  </section>

  <!-- The Field - Spatial Layout -->
  <section 
    class="absolute inset-0 w-full h-full cursor-grab select-none"
    class:cursor-grabbing={isDragging}
    role="application"
    aria-label="Witness field - drag to explore"
    on:mousedown={onFieldMouseDown}
    on:mousemove={onFieldMouseMove}
    on:mouseup={onFieldMouseUp}
    on:touchstart={onFieldTouchStart}
    on:touchmove={onFieldTouchMove}
    on:touchend={onFieldTouchEnd}
    on:contextmenu={onContextMenu}
  >
    <!-- Expanded Field Canvas -->
    <div 
      class="field-canvas"
      style="transform: translate({fieldOffset.x}px, {fieldOffset.y}px); width: {fieldWidth}px; height: {fieldHeight}px;"
    >
      <!-- Context Connection Lines - limit to visible witnesses for performance -->
      <svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: 1;">
        {#each activeWitnesses.slice(0, 100) as witness (witness.id)}
          {#if witness.contextOf}
            {@const parent = activeWitnesses.find(w => w.id === witness.contextOf)}
            {#if parent && parent.metadata.position && witness.metadata.position}
              {@const parentX = (parent.metadata.position.x / 100) * fieldWidth}
              {@const parentY = (parent.metadata.position.y / 100) * fieldHeight}
              {@const childX = (witness.metadata.position.x / 100) * fieldWidth}
              {@const childY = (witness.metadata.position.y / 100) * fieldHeight}
              {@const distanceToViewport = Math.sqrt(
                Math.pow(childX + fieldOffset.x - window.innerWidth/2, 2) + 
                Math.pow(childY + fieldOffset.y - window.innerHeight/2, 2)
              )}
              {#if distanceToViewport < 1500}
                {@const midX = (parentX + childX) / 2}
                {@const midY = (parentY + childY) / 2}
                <path 
                  d="M {parentX} {parentY} Q {midX} {midY} {childX} {childY}"
                  stroke="rgba(99, 102, 241, 0.2)"
                  stroke-width="1"
                  fill="none"
                  stroke-dasharray="2,2"
                />
              {/if}
            {/if}
          {/if}
        {/each}
      </svg>
      {#if activeWitnesses.length === 0}
        <div class="absolute" style="left: 50%; top: 50%; transform: translate(-50%, -50%);">
          <div class="text-center text-gray-400">
            <p class="text-lg font-light">The field is quiet...</p>
            <p class="text-sm mt-2">Be the first to witness something.</p>
          </div>
        </div>
      {:else}
        {#each activeWitnesses as witness (witness.id)}
          {@const position = witness.metadata.position || { x: 50, y: 50 }}
          {@const pixelX = (position.x / 100) * fieldWidth}
          {@const pixelY = (position.y / 100) * fieldHeight}
          {@const strength = getWitnessStrength(witness)}
          {@const entropySeed = witness.metadata.entropySeed || 0}
          {@const animationDuration = 4 + (entropySeed * 8)}
          {@const animationDelay = entropySeed * 3}
          <div
            class="absolute witness-floating {getAgeClass(witness.createdAt, witness.expiresAt)} strength-{strength}"
            class:centered={centeredWitness === witness.id}
            style="left: {pixelX}px; top: {pixelY}px; opacity: {getAgeOpacity(witness.createdAt, witness.expiresAt)}; transform: translate(-50%, -50%); z-index: 2; animation: float {animationDuration}s ease-in-out infinite; animation-delay: {animationDelay}s; transition: left 0.8s ease-out, top 0.8s ease-out, opacity 0.3s ease-out;"
            on:mousedown={(e) => onWitnessClick(e, witness)}
            on:touchstart={(e) => onWitnessTouch(e, witness)}
            on:contextmenu={(e) => onWitnessClick(e, witness)}
            role="button"
            tabindex="0"
            on:keydown={async (e) => {
              if (e.key === 'Enter') {
                onWitnessInteract(witness);
              }
            }}
          >
            <div class="witness-bubble" class:update-pulse={witnessUpdatePulses.has(witness.id)}>
              <p class="text-gray-700 leading-relaxed text-sm">
                {witness.text}
              </p>
              {#if witness.contextOf}
                <div class="context-indicator">
                  ∿
                </div>
              {/if}
            </div>
            <!-- Debug timer - only show with ?debug URL param -->
            {#if debugMode}
              <div class="time-remaining-debug">
                {getTimeRemaining(witness.expiresAt)}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <!-- Cluster Portal Toggle -->
  {#if witnessClusters.length > 1}
    <div class="fixed top-4 right-4 z-30">
      <button 
        class="bg-indigo-500 hover:bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg transition-colors"
        on:click={() => showClusterPortal = !showClusterPortal}
      >
        🌀 Islands ({witnessClusters.length})
      </button>
    </div>
  {/if}

  <!-- Cluster Portal -->
  {#if showClusterPortal && witnessClusters.length > 0}
    <div class="fixed top-16 right-4 z-30 bg-white/95 backdrop-blur-sm rounded-lg shadow-xl border border-gray-200 p-4 max-w-xs">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-gray-700">Witness Islands</h3>
        <button 
          class="text-gray-400 hover:text-gray-600 text-lg leading-none"
          on:click={() => showClusterPortal = false}
        >×</button>
      </div>
      
      <div class="space-y-2 max-h-64 overflow-y-auto">
        {#each witnessClusters as cluster, index}
          <button 
            class="w-full text-left p-3 rounded-lg bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 transition-colors"
            on:click={() => teleportToCluster(cluster)}
          >
            <div class="text-sm font-medium text-gray-700">
              Island {index + 1}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {cluster.size} witnesses • {getClusterSummary(cluster)}
            </div>
            <div class="text-xs text-indigo-600 mt-1">
              {cluster.witnesses.slice(0, 2).map((w: Witness) => `"${w.text.substring(0, 20)}..."`).join(', ')}
              {#if cluster.size > 2}
                <span class="text-gray-400">+{cluster.size - 2} more</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
      
      <div class="text-xs text-gray-400 mt-3 pt-2 border-t border-gray-200">
        Click an island to teleport there instantly
      </div>
    </div>
  {/if}

  <!-- Debug Panel -->
  {#if debugMode && debugStats}
    <div class="fixed top-4 left-4 z-30 bg-black/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-600 p-4 max-w-md text-white text-xs font-mono">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-green-400">🐛 DEBUG MODE</h3>
        <div class="text-xs text-gray-400">?debug</div>
      </div>
      
      <!-- Stats Overview -->
      <div class="grid grid-cols-2 gap-2 mb-4 text-xs">
        <div class="bg-gray-800 p-2 rounded">
          <div class="text-green-400">Total Witnesses</div>
          <div class="text-xl font-bold">{debugStats.totalWitnesses}</div>
        </div>
        <div class="bg-gray-800 p-2 rounded">
          <div class="text-blue-400">Active</div>
          <div class="text-xl font-bold">{debugStats.activeWitnesses}</div>
        </div>
        <div class="bg-gray-800 p-2 rounded">
          <div class="text-red-400">Expired</div>
          <div class="text-xl font-bold">{debugStats.expiredWitnesses}</div>
        </div>
        <div class="bg-gray-800 p-2 rounded">
          <div class="text-purple-400">Islands</div>
          <div class="text-xl font-bold">{debugStats.clusters}</div>
        </div>
      </div>

      <!-- Current Position -->
      <div class="mb-4 p-2 bg-gray-800 rounded">
        <div class="text-yellow-400 mb-1">Current Viewport Center</div>
        <div>Field: {debugStats.currentViewport.centerX}%, {debugStats.currentViewport.centerY}%</div>
        <div class="text-gray-400">Field Size: {debugStats.fieldSize.width}×{debugStats.fieldSize.height}px</div>
        <div class="text-gray-400">Status: {debugStats.connectionStatus}</div>
      </div>

      <!-- Sync Test Status -->
      <div class="mb-4 p-2 bg-gray-800 rounded">
        <div class="text-cyan-400 mb-1">🧪 Sync Test Status</div>
        <div class="text-xs">
          <div>Test Witnesses: <span class="text-green-400">{debugStats.testWitnesses}</span></div>
          <div>Last Refresh: {debugStats.lastRefresh.split('T')[1].split('.')[0]}</div>
          <div class="mt-1 text-gray-400">
            Run: <code class="bg-gray-700 px-1 rounded">node sync-verifier.js</code>
          </div>
          <div class="text-gray-400">
            Then refresh this page to test sync
          </div>
        </div>
      </div>

      <!-- Witness List -->
      <div class="mb-2">
        <div class="text-cyan-400 font-bold mb-2">All Witnesses ({activeWitnesses.length} active)</div>
        <div class="max-h-48 overflow-y-auto space-y-1">
          {#each activeWitnesses.slice().sort((a, b) => {
            const aInfo = getWitnessViewportInfo(a);
            const bInfo = getWitnessViewportInfo(b);
            return Number(aInfo?.distance || 999999) - Number(bInfo?.distance || 999999);
          }) as witness}
            {@const info = getWitnessViewportInfo(witness)}
            {#if info}
              <div class="flex items-center justify-between p-1 rounded {info.isVisible ? 'bg-green-900/50' : 'bg-gray-800/50'}">
                <div class="flex-1 min-w-0">
                  <div class="truncate text-xs">"{witness.text.substring(0, 30)}..."</div>
                  <div class="text-xs text-gray-400">
                    @{info.fieldX}%,{info.fieldY}% • {info.distance}px • {info.direction}
                    {#if info.isVisible}<span class="text-green-400">VISIBLE</span>{/if}
                  </div>
                </div>
                <button 
                  class="ml-2 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition-colors"
                  on:click={() => jumpToWitness(witness)}
                  title="Jump to this witness"
                >
                  GO
                </button>
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="text-xs text-gray-400 pt-2 border-t border-gray-600">
        Witnesses sorted by distance • Green = visible • Click GO to jump
      </div>
    </div>
  {/if}

  <!-- Navigation Help -->
  <div class="fixed bottom-4 right-4 text-xs text-gray-400 opacity-60">
    <p>drag to explore • click to select and witness in context</p>
  </div>

  <!-- Connection Status & Ambient Footer -->
  <div class="fixed bottom-4 left-4 text-xs text-gray-400 opacity-60">
    <div class="mb-1">
      {#if $connectionStatus.connected}
        <span class="text-green-500">● P2P connected ({$connectionStatus.peerCount} peers)</span>
      {:else}
        <span class="text-yellow-500">● Local only mode</span>
      {/if}
    </div>
    <div class="mb-2 text-xs opacity-80">
      Mode: <strong>EMERGENCY_RELAY</strong> (temporary clean slate)
    </div>
    <p>Collective consciousness emerges through shared witnessing.</p>
  </div>
</main>
