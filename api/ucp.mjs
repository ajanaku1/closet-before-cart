export const runtime = "nodejs";

const version = "2026-04-08";
const schemaRoot = `https://ucp.dev/${version}`;

function capability(specPath, schemaPath) {
  return [{
    version,
    spec: `${schemaRoot}/specification/${specPath}`,
    schema: `${schemaRoot}/schemas/${schemaPath}`,
  }];
}

const ucpProfile = {
  ucp: {
    version,
    services: {
      "dev.ucp.shopping": [{
        version,
        spec: `${schemaRoot}/specification/overview`,
        transport: "mcp",
        schema: `${schemaRoot}/services/shopping/mcp.openrpc.json`,
      }],
    },
    capabilities: {
      "dev.ucp.shopping.checkout": capability("checkout", "shopping/checkout.json"),
      "dev.ucp.shopping.cart": capability("cart", "shopping/cart.json"),
      "dev.ucp.shopping.catalog.search": capability(
        "catalog/search",
        "shopping/catalog_search.json",
      ),
      "dev.ucp.shopping.catalog.lookup": capability(
        "catalog/lookup",
        "shopping/catalog_lookup.json",
      ),
    },
    payment_handlers: {},
  },
};

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("allow", "GET");
    response.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED" } }));
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "public, max-age=300");
  response.end(JSON.stringify(ucpProfile));
}
