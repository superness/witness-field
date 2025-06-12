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
	
	// Initialize Gun with same config as main app
	const gun = Gun({
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
	gun.on('hi', (peer) => {
		if (peer && peer.url) {
			console.log('🟢 Gun connected to peer:', peer.url);
			gunConnected = true;
		} else {
			console.log('💾 Gun localStorage ready');
			gunConnected = true; // Count localStorage as connected
		}
	});
	
	gun.on('bye', (peer) => {
		if (peer && peer.url) {
			console.log('🔴 Gun disconnected from peer:', peer.url);
		} else {
			console.log('⚠️ Gun peer connection lost');
		}
		gunConnected = false;
	});
	
	onMount(() => {
		loadAllWitnesses();
	});
	
	async function loadAllWitnesses() {
		try {
			loading = true;
			allWitnesses = [];
			
			console.log('🔍 Starting debug witness loading...');
			
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
			
			// Also load from localStorage
			const localData = localStorage.getItem('witness-field-data');
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
		if (confirm('This will clear all locally stored witness data. Are you sure?')) {
			localStorage.removeItem('witness-field-data');
			alert('Local storage cleared. Refresh to reload from peers.');
		}
	}
	
	function createTestWitness() {
		const testText = `DEBUG_TEST_${Date.now()}`;
		console.log('Creating test witness:', testText);
		
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
			proofNonce: null,
			proofHash: null,
			entropySeed: Math.random(),
			contextTag: null,
			positionX: 50 + (Math.random() - 0.5) * 40,
			positionY: 50 + (Math.random() - 0.5) * 40
		};
		
		fieldNode.get(witnessId).put(testWitness);
		console.log('Test witness created:', testWitness);
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