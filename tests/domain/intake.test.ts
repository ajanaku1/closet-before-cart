import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLinqEvent } from "../../src/adapters/linq.ts";

const intakeModule = await import("../../src/domain/intake.ts").catch(() => ({}));

function prepare(
  event: NormalizedLinqEvent,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assert.equal(
    typeof intakeModule.prepareWardrobeIntake,
    "function",
    "wardrobe intake preparation must exist",
  );
  return intakeModule.prepareWardrobeIntake(event, options) as Promise<Record<string, unknown>>;
}

function event(attachmentCount: number = 7): NormalizedLinqEvent {
  return {
    eventId: "event-1",
    senderId: "sender-1",
    text: "Friday wedding, no black, one new item maximum",
    attachments: Array.from({ length: attachmentCount }, (_, index) => ({
      id: `photo-${index + 1}`,
      url: `https://cdn.linqapp.com/photo-${index + 1}`,
      mimeType: "image/jpeg",
    })),
  };
}

test("requires one reference and six wardrobe images before fetching", async () => {
  let requests = 0;

  await assert.rejects(
    prepare(event(6), {
      allowedHosts: ["cdn.linqapp.com"],
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    }),
    /seven image attachments/i,
  );
  assert.equal(requests, 0);
});

test("downloads allowlisted images and derives deterministic wedding constraints", async () => {
  const requested: string[] = [];
  const intake = await prepare(event(), {
    allowedHosts: ["cdn.linqapp.com"],
    fetch: async (url: string) => {
      requested.push(url);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    },
  });

  assert.equal(requested.length, 7);
  assert.deepEqual(intake.constraints, {
    occasion: "Friday wedding",
    requiredCategories: ["TOP", "BOTTOM", "SHOES"],
    excludedColors: ["BLACK"],
    maxNewItems: 1,
    referencePhotoPresent: true,
    minimumFormality: "SMART",
  });
  assert.deepEqual(intake.referencePhoto, {
    attachmentId: "photo-1",
    mimeType: "image/jpeg",
    bytes: new Uint8Array([1, 2, 3]),
  });
  assert.equal((intake.wardrobePhotos as unknown[]).length, 6);
});

test("rejects attachment hosts outside the configured Linq media boundary", async () => {
  const safeEvent = event();
  const unsafeEvent = {
    ...safeEvent,
    attachments: [
      { id: "photo-1", url: "https://internal.example/photo-1", mimeType: "image/jpeg" },
      ...safeEvent.attachments.slice(1),
    ],
  };

  await assert.rejects(
    prepare(unsafeEvent, {
      allowedHosts: ["cdn.linqapp.com"],
      fetch: async () => new Response(new Uint8Array([1])),
    }),
    /attachment host is not allowed/i,
  );
});

test("does not follow redirects away from an allowlisted media host", async () => {
  const redirects: Array<RequestRedirect | undefined> = [];

  await assert.rejects(
    prepare(event(), {
      allowedHosts: ["cdn.linqapp.com"],
      fetch: async (_url: string, init?: RequestInit) => {
        redirects.push(init?.redirect);
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.example/photo" },
        });
      },
    }),
    /fetch failed \(302\)/i,
  );
  assert.deepEqual(redirects, Array(7).fill("manual"));
});

test("rejects unsupported image formats before fetching", async () => {
  const unsupported = {
    ...event(),
    attachments: event().attachments.map((attachment, index) =>
      index === 0 ? { ...attachment, mimeType: "image/svg+xml" } : attachment),
  };
  let requests = 0;

  await assert.rejects(
    prepare(unsupported, {
      allowedHosts: ["cdn.linqapp.com"],
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    }),
    /unsupported image format/i,
  );
  assert.equal(requests, 0);
});

test("rejects oversized attachment bodies", async () => {
  await assert.rejects(
    prepare(event(), {
      allowedHosts: ["cdn.linqapp.com"],
      maxBytes: 2,
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      }),
    }),
    /attachment is too large/i,
  );
});

test("stops unsupported occasion constraints before fetching media", async () => {
  const unsupported = { ...event(), text: "surprise me" };
  let requests = 0;

  await assert.rejects(
    prepare(unsupported, {
      allowedHosts: ["cdn.linqapp.com"],
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    }),
    /supported occasion and one-item limit/i,
  );
  assert.equal(requests, 0);
});
