<script lang="ts">
	import { onMount } from 'svelte';
	import Gun from 'gun';
	import type { Witness } from '$lib/types';
	
	let allWitnesses: (Witness & { expired: boolean })[] = [];
	let loading = true;
	let error = '';
	let gunConnected = false;
	let sortBy: 'timestamp' | 'expiration' | 'witnessCount' = 'timestamp';
	let showExpired = true;
	let searchQuery = '';
	
	// Stress test state
	let stressTestRunning = false;
	let stressTestAgents = 20;
	let stressTestDuration = 300; // 5 minutes in seconds
	let stressTestStartTime = 0;
	let stressTestStats = {
		witnessesCreated: 0,
		rewitnessesPerformed: 0,
		elapsed: 0,
		agentsActive: 0
	};
	
	// Initialize Gun only in browser
	let gun: any = null;
	
	// Browser-only initialization
	if (typeof window !== 'undefined') {
		gun = Gun({
			peers: [
				'https://the-witness-field-production.up.railway.app/gun',
				'wss://the-witness-field-production.up.railway.app/gun'
			],
			localStorage: true,
			radisk: true,
			retry: 1,
			timeout: 5000
		});
		
		// Add more detailed connection logging
		gun.on('hi', (peer: any) => {
			if (peer && peer.url) {
				console.log('🟢 Gun connected to peer:', peer.url);
				gunConnected = true;
			} else {
				console.log('💾 Gun localStorage ready');
				gunConnected = true; // Count localStorage as connected
			}
		});
		
		gun.on('bye', (peer: any) => {
			if (peer && peer.url) {
				console.log('🔴 Gun disconnected from peer:', peer.url);
			} else {
				console.log('⚠️ Gun peer connection lost');
			}
			gunConnected = false;
		});
	}
	
	onMount(() => {
		loadAllWitnesses();
	});
	
	async function loadAllWitnesses() {
		try {
			loading = true;
			allWitnesses = [];
			
			console.log('🔍 Starting debug witness loading...');
			
			if (!gun) {
				console.log('⚠️ Gun not initialized yet');
				loading = false;
				return;
			}
			
			// Load from Gun - using v3 namespace to match main app  
			const fieldNode = gun.get('witness-field-collective-public-v3');
			console.log('📡 Connected to Gun namespace: witness-field-collective-public-v3');
			
			const loadWitnessData = (data: any, key: string) => {
				console.log('📥 Gun data received:', key, data);
				
				if (!data) return;
				
				// Skip non-witness data
				if (key === 'webrtc-signaling' || key === 'peers' || key.startsWith('webrtc-') || key.startsWith('peer-')) {
					return;
				}
				
				// Skip versioned copies
				if (key.includes('-v') && key.match(/-v\d+$/)) {
					console.log('Skipping versioned copy:', key);
					return;
				}
				
				let witness: Witness & { expired: boolean };
				
				try {
					// Handle old JSON string format
					if (typeof data === 'string') {
						console.log('Loading witness from JSON string format');
						const rawWitness = JSON.parse(data);
						witness = {
							...rawWitness,
							expired: Date.now() > rawWitness.expiresAt
						};
					} 
					// Handle new object format
					else if (typeof data === 'object' && data.id) {
						console.log('Loading witness from object format:', data);
						
						// Skip incomplete data
						if (!data.text || !data.createdAt || !data.expiresAt) {
							console.log('Skipping incomplete witness data:', data.id);
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
							},
							expired: Date.now() > data.expiresAt
						};
					} else {
						console.log('Skipping non-witness data:', key, data);
						return;
					}
					
					// Update or add witness
					const existingIndex = allWitnesses.findIndex(w => w.id === witness.id);
					if (existingIndex >= 0) {
						allWitnesses[existingIndex] = witness;
						console.log('Updated existing witness:', witness.id);
					} else {
						allWitnesses.push(witness);
						console.log('Added new witness:', witness.id, witness.text?.substring(0, 30) + '...');
					}
					allWitnesses = [...allWitnesses];
					
				} catch (e) {
					console.warn('Failed to parse witness data:', e, data);
				}
			};
			
			// Load existing witnesses immediately
			console.log('🔄 Loading existing witnesses with .once()...');
			fieldNode.map().once(loadWitnessData);
			
			// Listen for new witnesses in real-time
			console.log('👂 Setting up real-time listener with .on()...');
			fieldNode.map().on(loadWitnessData);
			
			// Summary after delay
			setTimeout(() => {
				console.log('📋 Loaded witnesses summary:', allWitnesses.length);
				loading = false;
			}, 3000);
			
			// Also load from localStorage (browser only)
			const localData = typeof window !== 'undefined' ? localStorage.getItem('witness-field-data') : null;
			if (localData) {
				try {
					const parsed = JSON.parse(localData);
					if (parsed.witnesses && Array.isArray(parsed.witnesses)) {
						const now = Date.now();
						parsed.witnesses.forEach((witness: Witness) => {
							const existingIndex = allWitnesses.findIndex(w => w.id === witness.id);
							if (existingIndex < 0) {
								allWitnesses.push({
									...witness,
									expired: now > witness.expiresAt
								});
							}
						});
						allWitnesses = [...allWitnesses];
					}
				} catch (e) {
					console.error('Error parsing localStorage:', e);
				}
			}
			
			loading = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
			loading = false;
		}
	}
	
	function exportAsJSON() {
		const dataStr = JSON.stringify(allWitnesses, null, 2);
		const blob = new Blob([dataStr], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `witness-field-debug-${new Date().toISOString()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
	
	function clearLocalStorage() {
		if (typeof window === 'undefined') {
			alert('Not available during server-side rendering');
			return;
		}
		
		if (confirm('This will clear all locally stored witness data. Are you sure?')) {
			localStorage.removeItem('witness-field-data');
			alert('Local storage cleared. Refresh to reload from peers.');
		}
	}
	
	// Copy the proof-of-work functions from witnessStore
	const computeProofOfWork = async (text: string): Promise<{nonce: number, hash: string}> => {
		return new Promise((resolve) => {
			const startTime = Date.now();
			let nonce = 0;
			
			const compute = () => {
				// Compute hash with nonce
				const data = text + nonce;
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
				
				// Continue computation in next tick to avoid blocking
				setTimeout(compute, 0);
			};
			
			compute();
		});
	};

	// Copy the proof-of-work verification function
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
		return calculatedHashSigned === proof.hash || calculatedHashUnsigned === proof.hash;
	};

	async function createTestWitness() {
		if (!gun) {
			alert('Gun not initialized yet');
			return;
		}
		
		const testText = `DEBUG_TEST_${Date.now()}`;
		console.log('Creating test witness with valid PoW:', testText);
		
		// Compute real proof of work (~1 second)
		const proof = await computeProofOfWork(testText.trim());
		console.log('Proof of work completed:', proof);
		
		const fieldNode = gun.get('witness-field-collective-public-v3');
		const witnessId = 'test_' + Math.random().toString(36).substr(2, 9);
		const now = Date.now();
		
		const testWitness = {
			id: witnessId,
			text: testText,
			createdAt: now,
			expiresAt: now + (10 * 60 * 1000), // 10 minutes
			witnessCount: 1,
			lastWitnessed: now,
			contextOf: null,
			proofNonce: proof.nonce,
			proofHash: proof.hash,
			entropySeed: Math.random(),
			contextTag: null,
			positionX: 50 + (Math.random() - 0.5) * 40,
			positionY: 50 + (Math.random() - 0.5) * 40
		};
		
		fieldNode.get(witnessId).put(testWitness);
		console.log('Test witness created with valid PoW:', testWitness);
	}
	
	
	// Sample agent personas and behaviors
	const agentPersonas = [
		{ name: 'Philosopher', topics: ['existence', 'consciousness', 'meaning', 'reality', 'truth', 'wisdom'] },
		{ name: 'Scientist', topics: ['discovery', 'hypothesis', 'experiment', 'observation', 'theory', 'data'] },
		{ name: 'Artist', topics: ['creation', 'beauty', 'expression', 'inspiration', 'vision', 'emotion'] },
		{ name: 'Wanderer', topics: ['journey', 'exploration', 'unknown', 'path', 'adventure', 'freedom'] },
		{ name: 'Dreamer', topics: ['possibility', 'imagination', 'hope', 'future', 'wonder', 'aspiration'] },
		{ name: 'Observer', topics: ['silence', 'watching', 'patterns', 'stillness', 'awareness', 'presence'] },
		{ name: 'Storyteller', topics: ['narrative', 'memory', 'legend', 'tale', 'history', 'myth'] },
		{ name: 'Seeker', topics: ['question', 'search', 'mystery', 'understanding', 'quest', 'discovery'] }
	];
	
	const witnessTemplates = [
		"In the {topic} of today, I witness {observation}",
		"The {topic} reveals itself as {insight}",
		"Through {perspective}, {topic} becomes {realization}",
		"Witnessing {moment} in the context of {topic}",
		"The essence of {topic} flows through {experience}",
		"In {state}, {topic} transforms into {understanding}",
		"Between {concept1} and {concept2}, {topic} emerges",
		"The rhythm of {topic} speaks: {message}",
		"In this moment, {topic} whispers {truth}",
		"Through the lens of {viewpoint}, {topic} appears as {vision}"
	];
	
	const concepts = [
		'light', 'shadow', 'time', 'space', 'breath', 'flow', 'balance', 'change',
		'connection', 'solitude', 'harmony', 'chaos', 'growth', 'decay', 'renewal',
		'energy', 'stillness', 'movement', 'thought', 'feeling', 'memory', 'dream'
	];
	
	function generateAgentWitness(persona: any): string {
		const template = witnessTemplates[Math.floor(Math.random() * witnessTemplates.length)];
		const topic = persona.topics[Math.floor(Math.random() * persona.topics.length)];
		const concept1 = concepts[Math.floor(Math.random() * concepts.length)];
		const concept2 = concepts[Math.floor(Math.random() * concepts.length)];
		
		return template
			.replace('{topic}', topic)
			.replace('{observation}', concept1 + ' dancing with ' + concept2)
			.replace('{insight}', 'a reflection of our shared ' + concept1)
			.replace('{perspective}', persona.name.toLowerCase() + "'s gaze")
			.replace('{realization}', 'the interconnected nature of ' + concept1)
			.replace('{moment}', 'this fleeting ' + concept1)
			.replace('{experience}', 'waves of ' + concept1)
			.replace('{state}', 'deep ' + concept1)
			.replace('{understanding}', 'pure ' + concept1)
			.replace('{concept1}', concept1)
			.replace('{concept2}', concept2)
			.replace('{message}', concept1 + ' seeks ' + concept2)
			.replace('{truth}', concept1 + ' is ' + concept2)
			.replace('{viewpoint}', concept1)
			.replace('{vision}', 'luminous ' + concept1);
	}
	
	async function startStressTest() {
		if (!gun) {
			alert('Gun not initialized yet');
			return;
		}
		
		stressTestRunning = true;
		stressTestStartTime = Date.now();
		stressTestStats = {
			witnessesCreated: 0,
			rewitnessesPerformed: 0,
			elapsed: 0,
			agentsActive: 0
		};
		
		console.log(`🚀 Starting stress test with ${stressTestAgents} agents for ${stressTestDuration} seconds`);
		
		const fieldNode = gun.get('witness-field-collective-public-v3');
		const activeAgents = new Set();
		
		// Update stats every second
		const statsInterval = setInterval(() => {
			if (!stressTestRunning) {
				clearInterval(statsInterval);
				return;
			}
			
			stressTestStats.elapsed = Math.floor((Date.now() - stressTestStartTime) / 1000);
			stressTestStats.agentsActive = activeAgents.size;
			stressTestStats = { ...stressTestStats }; // Trigger reactivity
			
			if (stressTestStats.elapsed >= stressTestDuration) {
				stopStressTest();
			}
		}, 1000);
		
		// Create agent behaviors
		for (let agentId = 0; agentId < stressTestAgents; agentId++) {
			const persona = agentPersonas[agentId % agentPersonas.length];
			const agentName = `${persona.name}_${agentId}`;
			
			// Each agent has different timing patterns
			const baseInterval = 3000 + Math.random() * 7000; // 3-10 seconds
			const rewitnessChance = 0.3; // 30% chance to rewitness instead of creating
			
			const agentLoop = async () => {
				if (!stressTestRunning) return;
				
				activeAgents.add(agentName);
				
				try {
					// Decide whether to create new witness or rewitness existing
					const shouldRewitness = Math.random() < rewitnessChance && allWitnesses.length > 0;
					
					if (shouldRewitness) {
						// Rewitness a random existing witness
						const activeWitnesses = allWitnesses.filter(w => !w.expired);
						if (activeWitnesses.length > 0) {
							const targetWitness = activeWitnesses[Math.floor(Math.random() * activeWitnesses.length)];
							
							// Simulate rewitnessing by updating witness count
							const updatedWitness = {
								...targetWitness,
								witnessCount: targetWitness.witnessCount + 1,
								lastWitnessed: Date.now()
							};
							
							// Update in Gun
							fieldNode.get(targetWitness.id).put({
								id: targetWitness.id,
								text: targetWitness.text,
								createdAt: targetWitness.createdAt,
								expiresAt: targetWitness.expiresAt,
								witnessCount: updatedWitness.witnessCount,
								lastWitnessed: updatedWitness.lastWitnessed,
								contextOf: targetWitness.contextOf || null,
								proofNonce: targetWitness.proof?.nonce || null,
								proofHash: targetWitness.proof?.hash || null,
								entropySeed: targetWitness.metadata?.entropySeed || Math.random(),
								contextTag: targetWitness.metadata?.contextTag || null,
								positionX: targetWitness.metadata?.position?.x || null,
								positionY: targetWitness.metadata?.position?.y || null,
								lastUpdate: Date.now()
							});
							
							stressTestStats.rewitnessesPerformed++;
							console.log(`👥 ${agentName} rewitnessed: ${targetWitness.text.substring(0, 30)}...`);
						}
					} else {
						// Create new witness with valid proof-of-work
						const witnessText = generateAgentWitness(persona);
						
						// Compute real proof of work (~1 second) 
						const proof = await computeProofOfWork(witnessText.trim());
						
						const witnessId = `stress_${agentName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
						const now = Date.now();
						
						// Choose context witness sometimes
						let contextOf = null;
						if (allWitnesses.length > 0 && Math.random() < 0.4) { // 40% chance of context
							const activeWitnesses = allWitnesses.filter(w => !w.expired);
							if (activeWitnesses.length > 0) {
								contextOf = activeWitnesses[Math.floor(Math.random() * activeWitnesses.length)].id;
							}
						}
						
						const stressWitness = {
							id: witnessId,
							text: witnessText,
							createdAt: now,
							expiresAt: now + (10 * 60 * 1000), // 10 minutes for testing
							witnessCount: 1,
							lastWitnessed: now,
							contextOf: contextOf,
							proofNonce: proof.nonce,
							proofHash: proof.hash,
							entropySeed: Math.random(),
							contextTag: persona.name,
							positionX: 10 + Math.random() * 80, // Keep in viewable area
							positionY: 10 + Math.random() * 80
						};
						
						fieldNode.get(witnessId).put(stressWitness);
						stressTestStats.witnessesCreated++;
						console.log(`✨ ${agentName} created with valid PoW: ${witnessText.substring(0, 50)}...`);
					}
				} catch (error) {
					console.error(`❌ Agent ${agentName} error:`, error);
				}
				
				// Schedule next action with some randomness
				if (stressTestRunning) {
					const nextInterval = baseInterval * (0.8 + Math.random() * 0.4); // ±20% variance
					setTimeout(agentLoop, nextInterval);
				} else {
					activeAgents.delete(agentName);
				}
			};
			
			// Start each agent with staggered timing
			setTimeout(agentLoop, Math.random() * 5000);
		}
	}
	
	function stopStressTest() {
		stressTestRunning = false;
		console.log('🛑 Stress test stopped');
		console.log('📊 Final stats:', stressTestStats);
	}
	
	$: filteredWitnesses = allWitnesses
		.filter(w => showExpired || !w.expired)
		.filter(w => !searchQuery || 
			w.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
			w.id.includes(searchQuery))
		.sort((a, b) => {
			switch (sortBy) {
				case 'timestamp':
					return b.createdAt - a.createdAt;
				case 'expiration':
					return b.expiresAt - a.expiresAt;
				case 'witnessCount':
					return b.witnessCount - a.witnessCount;
				default:
					return 0;
			}
		});
	
	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
	}
	
	function getTimeRemaining(expiresAt: number): string {
		const now = Date.now();
		const diff = expiresAt - now;
		if (diff <= 0) return 'Expired';
		
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}
</script>

<svelte:head>
	<title>Witness Field Debug</title>
</svelte:head>

<div class="debug-container">
	<header>
		<h1>Witness Field Debug View</h1>
		<div class="status">
			<span class="status-item">
				Gun: <span class={gunConnected ? 'connected' : 'disconnected'}>
					{gunConnected ? 'Connected' : 'Disconnected'}
				</span>
			</span>
			<span class="status-item">
				Total Witnesses: <strong>{allWitnesses.length}</strong>
			</span>
			<span class="status-item">
				Active: <strong>{allWitnesses.filter(w => !w.expired).length}</strong>
			</span>
			<span class="status-item">
				Expired: <strong>{allWitnesses.filter(w => w.expired).length}</strong>
			</span>
			<span class="status-item">
				Valid PoW: <strong class="pow-valid">{allWitnesses.filter(w => w.proof && verifyProofOfWork(w.text.trim(), w.proof)).length}</strong>
			</span>
			<span class="status-item">
				Invalid PoW: <strong class="pow-invalid">{allWitnesses.filter(w => w.proof && !verifyProofOfWork(w.text.trim(), w.proof)).length}</strong>
			</span>
			<span class="status-item">
				No Proof: <strong class="pow-missing">{allWitnesses.filter(w => !w.proof).length}</strong>
			</span>
		</div>
	</header>

	<div class="controls">
		<div class="control-group">
			<label>
				<input type="checkbox" bind:checked={showExpired} />
				Show Expired
			</label>
			
			<label>
				Sort by:
				<select bind:value={sortBy}>
					<option value="timestamp">Creation Time</option>
					<option value="expiration">Expiration Time</option>
					<option value="witnessCount">Witness Count</option>
				</select>
			</label>
			
			<input 
				type="text" 
				placeholder="Search witnesses..." 
				bind:value={searchQuery}
			/>
		</div>
		
		<div class="actions">
			<button on:click={loadAllWitnesses}>Refresh</button>
			<button on:click={exportAsJSON}>Export JSON</button>
			<button on:click={createTestWitness}>Create Test Witness</button>
			<button on:click={clearLocalStorage} class="danger">Clear Local Storage</button>
		</div>
		
		<div class="stress-test-controls">
			<h3>🔥 Stress Test</h3>
			<div class="stress-controls">
				<label>
					Agents: 
					<input type="number" bind:value={stressTestAgents} min="1" max="100" disabled={stressTestRunning} />
				</label>
				<label>
					Duration (seconds): 
					<input type="number" bind:value={stressTestDuration} min="10" max="3600" disabled={stressTestRunning} />
				</label>
				{#if stressTestRunning}
					<button on:click={stopStressTest} class="danger">Stop Test</button>
				{:else}
					<button on:click={startStressTest} class="stress">Start Stress Test</button>
				{/if}
			</div>
			
			{#if stressTestRunning || stressTestStats.witnessesCreated > 0}
				<div class="stress-stats">
					<div class="stat-grid">
						<div class="stat">
							<span class="stat-label">Running:</span>
							<span class="stat-value">{stressTestStats.elapsed}s / {stressTestDuration}s</span>
						</div>
						<div class="stat">
							<span class="stat-label">Active Agents:</span>
							<span class="stat-value">{stressTestStats.agentsActive}</span>
						</div>
						<div class="stat">
							<span class="stat-label">Witnesses Created:</span>
							<span class="stat-value">{stressTestStats.witnessesCreated}</span>
						</div>
						<div class="stat">
							<span class="stat-label">Rewitnesses:</span>
							<span class="stat-value">{stressTestStats.rewitnessesPerformed}</span>
						</div>
					</div>
					<div class="progress-bar">
						<div class="progress-fill" style="width: {(stressTestStats.elapsed / stressTestDuration) * 100}%"></div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="loading">Loading witnesses...</div>
	{:else if error}
		<div class="error">Error: {error}</div>
	{:else}
		<div class="witness-grid">
			{#each filteredWitnesses as witness}
				<div class="witness-card" class:expired={witness.expired}>
					<div class="witness-header">
						<span class="witness-id">{witness.id.slice(0, 8)}...</span>
						<span class="witness-status">{witness.expired ? 'EXPIRED' : 'ACTIVE'}</span>
					</div>
					
					<div class="witness-text">{witness.text}</div>
					
					<div class="witness-meta">
						<div class="meta-row">
							<span>Created:</span>
							<span>{formatDate(witness.createdAt)}</span>
						</div>
						<div class="meta-row">
							<span>Expires:</span>
							<span>{formatDate(witness.expiresAt)} ({getTimeRemaining(witness.expiresAt)})</span>
						</div>
						<div class="meta-row">
							<span>Position:</span>
							<span>
								{#if witness.metadata?.position}
									x: {witness.metadata.position.x.toFixed(2)}%, y: {witness.metadata.position.y.toFixed(2)}%
								{:else}
									No position data
								{/if}
							</span>
						</div>
						<div class="meta-row">
							<span>Witness Count:</span>
							<span>{witness.witnessCount}</span>
						</div>
						<div class="meta-row">
							<span>Proof of Work:</span>
							<span class="pow-status">
								{#if witness.proof}
									{@const isValid = verifyProofOfWork(witness.text.trim(), witness.proof)}
									<span class={isValid ? 'pow-valid' : 'pow-invalid'}>
										{isValid ? '✅ VALID' : '❌ INVALID'}
									</span>
									<span class="pow-details">
										(nonce: {witness.proof.nonce}, hash: {witness.proof.hash})
									</span>
								{:else}
									<span class="pow-missing">❓ NO PROOF</span>
								{/if}
							</span>
						</div>
						{#if witness.contextOf}
							<div class="meta-row">
								<span>Context of:</span>
								<span>{witness.contextOf.slice(0, 8)}...</span>
							</div>
						{/if}
					</div>
					
					<details class="raw-data">
						<summary>Raw Data</summary>
						<pre>{JSON.stringify(witness, null, 2)}</pre>
					</details>
				</div>
			{/each}
		</div>
		
		{#if filteredWitnesses.length === 0}
			<div class="empty">No witnesses found matching your criteria</div>
		{/if}
	{/if}
</div>

<style>
	.debug-container {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		font-family: monospace;
	}
	
	header {
		margin-bottom: 2rem;
	}
	
	h1 {
		margin: 0 0 1rem 0;
		color: #333;
	}
	
	.status {
		display: flex;
		gap: 2rem;
		font-size: 0.9rem;
	}
	
	.status-item {
		color: #666;
	}
	
	.connected {
		color: #0f0;
		font-weight: bold;
	}
	
	.disconnected {
		color: #f00;
		font-weight: bold;
	}
	
	.controls {
		background: #f5f5f5;
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
	}
	
	.control-group {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	
	button {
		padding: 0.5rem 1rem;
		border: 1px solid #ddd;
		background: white;
		cursor: pointer;
		border-radius: 4px;
	}
	
	button:hover {
		background: #f0f0f0;
	}
	
	button.danger {
		color: #f00;
		border-color: #f00;
	}
	
	button.danger:hover {
		background: #fee;
	}
	
	button.stress {
		color: #f80;
		border-color: #f80;
		font-weight: bold;
	}
	
	button.stress:hover {
		background: #fff8f0;
	}
	
	.stress-test-controls {
		background: #f0f8ff;
		border: 2px solid #4a90e2;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 2rem;
	}
	
	.stress-test-controls h3 {
		margin: 0 0 1rem 0;
		color: #2c5aa0;
	}
	
	.stress-controls {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	
	.stress-controls label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: bold;
	}
	
	.stress-controls input[type="number"] {
		width: 80px;
		padding: 0.25rem;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	
	.stress-stats {
		border-top: 1px solid #ddd;
		padding-top: 1rem;
	}
	
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	.stat {
		background: white;
		padding: 0.5rem;
		border-radius: 4px;
		border: 1px solid #ddd;
		text-align: center;
	}
	
	.stat-label {
		display: block;
		font-size: 0.8rem;
		color: #666;
		margin-bottom: 0.25rem;
	}
	
	.stat-value {
		display: block;
		font-size: 1.2rem;
		font-weight: bold;
		color: #2c5aa0;
	}
	
	.progress-bar {
		background: #e9ecef;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
	}
	
	.progress-fill {
		background: linear-gradient(to right, #4a90e2, #f80);
		height: 100%;
		transition: width 0.3s ease;
	}
	
	.pow-status {
		font-family: monospace;
		font-size: 0.8rem;
	}
	
	.pow-valid {
		color: #0a0;
		font-weight: bold;
	}
	
	.pow-invalid {
		color: #f00;
		font-weight: bold;
	}
	
	.pow-missing {
		color: #fa0;
		font-weight: bold;
	}
	
	.pow-details {
		color: #666;
		font-size: 0.7rem;
		display: block;
		margin-top: 0.2rem;
	}
	
	input[type="text"] {
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		width: 200px;
	}
	
	select {
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	
	.loading, .error, .empty {
		text-align: center;
		padding: 2rem;
		color: #666;
	}
	
	.error {
		color: #f00;
	}
	
	.witness-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1rem;
	}
	
	.witness-card {
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 1rem;
		background: white;
		transition: all 0.2s;
	}
	
	.witness-card:hover {
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}
	
	.witness-card.expired {
		opacity: 0.6;
		background: #fafafa;
		border-color: #ccc;
	}
	
	.witness-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		font-size: 0.8rem;
	}
	
	.witness-id {
		color: #666;
		font-family: monospace;
	}
	
	.witness-status {
		font-weight: bold;
		color: #0a0;
	}
	
	.expired .witness-status {
		color: #a00;
	}
	
	.witness-text {
		margin: 1rem 0;
		padding: 0.5rem;
		background: #f9f9f9;
		border-radius: 4px;
		line-height: 1.4;
	}
	
	.witness-meta {
		font-size: 0.8rem;
		color: #666;
	}
	
	.meta-row {
		display: flex;
		justify-content: space-between;
		padding: 0.2rem 0;
	}
	
	.raw-data {
		margin-top: 1rem;
		font-size: 0.8rem;
	}
	
	.raw-data summary {
		cursor: pointer;
		color: #666;
		padding: 0.5rem 0;
	}
	
	.raw-data pre {
		background: #f5f5f5;
		padding: 0.5rem;
		border-radius: 4px;
		overflow-x: auto;
		max-height: 200px;
		overflow-y: auto;
		font-size: 0.7rem;
		margin: 0.5rem 0 0 0;
	}
</style>