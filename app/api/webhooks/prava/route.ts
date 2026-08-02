export async function POST(_request: Request): Promise<Response> {
  return Response.json(
    { error: { code: "PRAVA_CALLBACK_NOT_CONFIGURED", message: "The requested operation could not be completed." } },
    { status: 503 },
  );
}
