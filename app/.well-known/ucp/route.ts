import { ucpProfile } from "../../../src/contracts/ucp-profile.ts";

export async function GET(): Promise<Response> {
  return Response.json(ucpProfile, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
