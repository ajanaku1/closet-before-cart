import { renderProofDocument, type ProofPageModel } from "../../../src/presentation/proof-page.ts";

interface ProofPageProps {
  readonly params: { readonly token: string };
}

export default function ProofPage({ params }: ProofPageProps): string {
  const model: ProofPageModel = {
    caseId: params.token,
    decision: "LOADING",
    finding: "Checking the signed proof.",
    occasion: "Private proof link",
    ownedItems: [],
  };
  return renderProofDocument(model);
}
