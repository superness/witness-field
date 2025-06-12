// Store mode selector - switch between emergency and P2P modes
export type StoreMode = 'emergency' | 'p2p';

// Default to emergency mode for now (stable)
export const CURRENT_STORE_MODE: StoreMode = 'emergency';

// Dynamic imports based on mode
export const getStoreModule = async (mode: StoreMode) => {
  switch (mode) {
    case 'p2p':
      return await import('./witnessStore-p2p.js');
    case 'emergency':
    default:
      return await import('./witnessStore-emergency.js');
  }
};

// Helper to get current store
export const getCurrentStore = () => getStoreModule(CURRENT_STORE_MODE);