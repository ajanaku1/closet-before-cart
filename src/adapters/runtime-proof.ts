import type { ProofCodec } from "../contracts/adapters.js";
import { issueStyleProof } from "../domain/proof.js";

export function createRuntimeProofCodec(secret: string): ProofCodec {
  if (secret.length < 32) throw new Error("Style Proof secret must be at least 32 characters");
  return {
    async issue(payload) {
      const ttlSeconds = (Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt)) / 1000;
      const { issuedAt, expiresAt: _expiresAt, ...input } = payload;
      return issueStyleProof(input, secret, issuedAt, ttlSeconds);
    },
    async verify() {
      throw new Error("Proof verification requires the proof repository");
    },
  };
}
