# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Development
npm run dev              # Start development server with hot reload
npm run build            # Build for production
npm run preview          # Preview production build locally

# Type checking and validation
npm run check            # Run TypeScript and Svelte checks
npm run check:watch      # Run checks in watch mode
```

## Architecture Overview

**Witness Field** is a decentralized, anonymous, ephemeral witnessing application built with SvelteKit. It creates a spatial "field" where users can place anonymous thoughts that fade away over time.

### Core Components

- **witnessStore.ts**: Central P2P data layer using Gun.js with WebRTC, BroadcastChannel, and localStorage sync
- **types.ts**: TypeScript definitions for Witness objects and metadata
- **+page.svelte**: Main spatial interface with drag-to-explore field navigation

### Key Architecture Patterns

**P2P Data Synchronization**: Multi-layered sync strategy using:
- Gun.js for decentralized data persistence and relay-based P2P
- WebRTC for direct peer-to-peer connections 
- BroadcastChannel for same-device cross-tab synchronization
- localStorage for offline persistence

**Spatial Positioning System**: Witnesses are positioned in a 2D field using percentage-based coordinates with:
- Physics-based drift simulation for ambient movement
- Context-aware positioning (new witnesses appear near their inspiration)
- Anti-collision systems to prevent overlapping

**Entropy-Based Lifecycle**: Witnesses have dynamic lifespans influenced by:
- Base expiration time (24 hours production, 10 minutes dev mode)
- Collective validation (re-witnessing extends lifetime)
- Proof-of-work system (~1 second computation) for spam prevention

### Development Modes

The application has a `DEV_MODE` constant in witnessStore.ts that affects:
- Witness expiration times (10 minutes vs 24 hours)
- Debug UI elements and console output
- Physics simulation parameters

### P2P Configuration

P2P behavior is controlled by `P2P_MODE` in witnessStore.ts:
- `PUBLIC_RELAY`: Uses public Gun.js relays (default)
- `CUSTOM_RELAY`: Uses custom relay server 
- `LOCAL_ONLY`: No P2P, localStorage only

### State Management

Uses Svelte stores with reactive patterns:
- `witnesses`: Array of all witness objects
- `connectionStatus`: P2P connection state
- Real-time updates via Gun.js `.on()` callbacks
- Automatic cleanup of expired witnesses

## Important Implementation Details

**Proof of Work**: Each witness creation/validation requires ~1 second of computation to prevent spam while maintaining usability.

**Field Navigation**: The interface uses a draggable infinite canvas with resistance-based constraints to keep witnesses in view.

**Context System**: Witnesses can be created "in context of" other witnesses, creating conceptual connections visualized with curved SVG lines.

**Cross-Platform Sync**: The same witness field is shared across all users via Gun.js namespace `witness-field-collective-public-v1`.