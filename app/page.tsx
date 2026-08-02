import { demoGapProof, renderProofDocument } from "../src/presentation/proof-page.ts";

export default function Page(): string {
  return renderProofDocument(demoGapProof);
}
