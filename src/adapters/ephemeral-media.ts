import type { MediaStore } from "../contracts/adapters.js";

export class EphemeralMediaStore implements MediaStore {
  private readonly cases = new Map<string, Map<string, Uint8Array>>();

  async saveTemporary(caseId: string, attachmentId: string, bytes: Uint8Array): Promise<void> {
    const media = this.cases.get(caseId) ?? new Map<string, Uint8Array>();
    media.set(attachmentId, bytes.slice());
    this.cases.set(caseId, media);
  }

  async deleteCaseMedia(caseId: string): Promise<void> {
    this.cases.delete(caseId);
  }
}
