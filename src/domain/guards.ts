export type EventClaim = "NEW" | "DUPLICATE";

export function claimExternalEvent(claimed: Set<string>, key: string): EventClaim {
  if (claimed.has(key)) return "DUPLICATE";
  claimed.add(key);
  return "NEW";
}

export function formatSafeError(code: string, requestId: string): {
  error: { code: string; message: string; requestId: string };
} {
  return {
    error: {
      code,
      message: "The requested operation could not be completed.",
      requestId,
    },
  };
}
