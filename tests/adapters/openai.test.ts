import assert from "node:assert/strict";
import test from "node:test";

const adapterModule = await import("../../src/adapters/openai.ts").catch(() => ({}));

function adapter(options: Record<string, unknown>): {
  extractWardrobe(photos: readonly unknown[]): Promise<unknown>;
  renderOutfit(referencePhoto: Uint8Array, garments: readonly unknown[]): Promise<{ imageUrl: string }>;
} {
  assert.equal(
    typeof adapterModule.createOpenAIWardrobeAdapter,
    "function",
    "OpenAI wardrobe adapter factory must exist",
  );
  return adapterModule.createOpenAIWardrobeAdapter(options) as {
    extractWardrobe(photos: readonly unknown[]): Promise<unknown>;
    renderOutfit(referencePhoto: Uint8Array, garments: readonly unknown[]): Promise<{ imageUrl: string }>;
  };
}

const photos = [
  {
    attachmentId: "photo-1",
    mimeType: "image/jpeg",
    bytes: new Uint8Array([1, 2, 3]),
  },
];

function responseBody(sourceAttachmentId: string = "photo-1"): object {
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              garments: [
                {
                  sourceAttachmentId,
                  category: "TOP",
                  color: "WHITE",
                  pattern: "SOLID",
                  formality: "FORMAL",
                  weatherSuitability: "ALL",
                  confidence: 0.98,
                },
              ],
              missingFields: [],
            }),
          },
        ],
      },
    ],
  };
}

test("sends image inputs through Responses API with a strict extraction schema", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Response.json(responseBody());
    },
  });

  const extraction = await openAI.extractWardrobe(photos) as {
    garments: Array<Record<string, unknown>>;
    missingFields: string[];
  };
  const request = requests[0];
  assert.ok(request);
  const body = JSON.parse(String(request.init?.body));

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(new Headers(request.init?.headers).get("authorization"), "Bearer fixture-key");
  assert.equal(body.model, "gpt-5.6-sol");
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "low");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.match(JSON.stringify(body.input), /data:image\/jpeg;base64,AQID/);
  const garment = extraction.garments[0];
  assert.ok(garment);
  assert.deepEqual({ ...garment, digest: undefined }, {
    id: "garment-photo-1",
    sourceAttachmentId: "photo-1",
    category: "TOP",
    color: "WHITE",
    pattern: "SOLID",
    formality: "FORMAL",
    weatherSuitability: "ALL",
    confidence: 0.98,
    digest: undefined,
  });
  assert.match(String(garment.digest), /^[a-f0-9]{64}$/);
  assert.deepEqual(extraction.missingFields, []);
});

test("rejects a model result that references an unknown photo", async () => {
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async () => Response.json(responseBody("unknown-photo")),
  });

  await assert.rejects(openAI.extractWardrobe(photos), /unknown source attachment/i);
});

test("uses fixed image order when OpenAI repeats a known attachment id", async () => {
  const secondPhoto = {
    attachmentId: "photo-2",
    mimeType: "image/jpeg",
    bytes: new Uint8Array([4, 5, 6]),
  };
  const duplicated = responseBody() as {
    output: Array<{ content: Array<{ text: string }> }>;
  };
  const content = duplicated.output[0]?.content[0];
  assert.ok(content);
  const parsed = JSON.parse(content.text);
  parsed.garments.push({ ...parsed.garments[0] });
  content.text = JSON.stringify(parsed);
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async () => Response.json(duplicated),
  });

  const extraction = await openAI.extractWardrobe([...photos, secondPhoto]) as {
    garments: Array<{ sourceAttachmentId: string }>;
  };

  assert.deepEqual(
    extraction.garments.map(({ sourceAttachmentId }) => sourceAttachmentId),
    ["photo-1", "photo-2"],
  );
});

test("does not expose an OpenAI error response body", async () => {
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async () => new Response("provider-secret-detail", { status: 429 }),
  });

  await assert.rejects(
    openAI.extractWardrobe(photos),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /failed \(429\)/i);
      assert.doesNotMatch(error.message, /provider-secret-detail/);
      return true;
    },
  );
});

test("renders an outfit from the reference photo and extracted garment evidence", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Response.json({
        output: [{ type: "image_generation_call", result: "aW1hZ2U=" }],
      });
    },
  });

  const rendered = await openAI.renderOutfit(new Uint8Array([1, 2, 3]), [{
    id: "garment-1",
    category: "TOP",
    color: "WHITE",
    formality: "FORMAL",
    confidence: 0.98,
  }]);
  const body = JSON.parse(String(requests[0]?.init?.body));

  assert.equal(rendered.imageUrl, "data:image/png;base64,aW1hZ2U=");
  assert.equal(body.tools[0].type, "image_generation");
  assert.equal(body.tools[0].action, "edit");
  assert.match(JSON.stringify(body.input), /data:image\/jpeg;base64,AQID/);
  assert.doesNotMatch(JSON.stringify(body), /garment-1.*garment-1/);
});

test("fails closed when image generation returns no image", async () => {
  const openAI = adapter({
    apiKey: "fixture-key",
    fetch: async () => Response.json({ output: [] }),
  });

  await assert.rejects(
    openAI.renderOutfit(new Uint8Array([1]), []),
    /no generated image/i,
  );
});
