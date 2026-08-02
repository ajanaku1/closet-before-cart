const VERSION = "2026-04-08";
const SCHEMA_ROOT = `https://ucp.dev/${VERSION}`;

function capability(specPath: string, schemaPath: string) {
  return [
    {
      version: VERSION,
      spec: `${SCHEMA_ROOT}/specification/${specPath}`,
      schema: `${SCHEMA_ROOT}/schemas/${schemaPath}`,
    },
  ];
}

export const ucpProfile = {
  ucp: {
    version: VERSION,
    services: {
      "dev.ucp.shopping": [
        {
          version: VERSION,
          spec: `${SCHEMA_ROOT}/specification/overview`,
          transport: "mcp",
          schema: `${SCHEMA_ROOT}/services/shopping/mcp.openrpc.json`,
        },
      ],
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
} as const;
