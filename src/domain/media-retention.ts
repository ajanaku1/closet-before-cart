export type RawMediaStatus = "EXTRACTING" | "EXTRACTED" | "RENDERED" | "FAILED";

export function shouldDeleteRawMedia(status: RawMediaStatus): boolean {
  return status === "RENDERED" || status === "FAILED";
}
