function errorResponse(code: string, status: number): Response {
  return Response.json({ error: { code, message: "The requested proof is unavailable." } }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  if (!token || token.length > 512) return errorResponse("INVALID_PROOF", 404);
  return errorResponse("PROOF_STORE_NOT_CONFIGURED", 503);
}
