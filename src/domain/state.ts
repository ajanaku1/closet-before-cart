import type { CaseState } from "../contracts/domain.js";

const transitions: ReadonlyMap<CaseState, readonly CaseState[]> = new Map([
  ["RECEIVED", ["EXTRACTING"]],
  ["EXTRACTING", ["WARDROBE_READY", "MORE_EVIDENCE"]],
  ["WARDROBE_READY", ["RENDERING"]],
  ["RENDERING", ["STYLE_READY", "GAP_FOUND", "MORE_EVIDENCE"]],
  ["MORE_EVIDENCE", ["EXTRACTING"]],
  ["STYLE_READY", []],
  ["GAP_FOUND", ["QUOTING"]],
  ["QUOTING", ["AWAITING_APPROVAL", "FAILED"]],
  ["AWAITING_APPROVAL", ["PAYMENT_PROCESSING", "FAILED"]],
  ["PAYMENT_PROCESSING", ["SANDBOX_COMPLETED", "ORDER_COMPLETED", "FAILED"]],
  ["SANDBOX_COMPLETED", []],
  ["ORDER_COMPLETED", []],
  ["FAILED", []],
]);

export function canTransition(from: CaseState, to: CaseState): boolean {
  return transitions.get(from)?.includes(to) ?? false;
}
