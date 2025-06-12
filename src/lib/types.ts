export interface Witness {
  id: string;
  text: string;
  createdAt: number;
  expiresAt: number;
  witnessCount: number; // How many times this has been witnessed
  lastWitnessed: number; // When it was last witnessed (for entropy)
  contextOf?: string | null; // ID of witness this was created in context of
  proof?: {
    nonce: number;
    hash: string;
  }; // Proof of work
  metadata: {
    affect?: string;
    entropySeed?: number;
    contextTag?: string; // Conceptual keyword/theme
    position?: {
      x: number; // 0-100% of viewport width
      y: number; // 0-100% of viewport height
    };
    lastUpdate?: number; // Timestamp of last update for sync tracking
  };
}

export interface WitnessStore {
  witnesses: Witness[];
  addWitness: (text: string, contextOf?: string) => void;
  reWitness: (witnessId: string) => void;
  getActiveWitnesses: () => Witness[];
}