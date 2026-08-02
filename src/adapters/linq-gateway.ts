type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface LinqReply {
  readonly text?: string;
  readonly imageUrl?: string;
  readonly idempotencyKey: string;
}

export interface LinqGatewayOptions {
  readonly apiKey: string;
  readonly fetch?: Fetcher;
}

function replyParts(reply: LinqReply): Array<Record<string, string>> {
  const parts: Array<Record<string, string>> = [];
  if (reply.text) parts.push({ type: "text", value: reply.text });
  if (reply.imageUrl) parts.push({ type: "media", url: reply.imageUrl });
  if (parts.length === 0) throw new Error("Linq reply content is required");
  return parts;
}

function replyRequest(apiKey: string, reply: LinqReply): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: { parts: replyParts(reply), idempotency_key: reply.idempotencyKey },
    }),
    signal: AbortSignal.timeout(15_000),
  };
}

function messageId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Linq response must be an object");
  }
  const record = value as Record<string, unknown>;
  const data = typeof record.data === "object" && record.data !== null
    ? record.data as Record<string, unknown>
    : record;
  const message = typeof data.message === "object" && data.message !== null
    ? data.message as Record<string, unknown>
    : data;
  if (typeof message.id !== "string" || message.id === "") {
    throw new Error("Linq response is missing message id");
  }
  return message.id;
}

function typingRequest(apiKey: string, method: "POST" | "DELETE"): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  };
}

export function createLinqGateway(options: LinqGatewayOptions) {
  if (!options.apiKey.trim()) throw new Error("Linq API key is required");
  const fetcher = options.fetch ?? fetch;
  async function setTyping(chatId: string, method: "POST" | "DELETE"): Promise<void> {
    if (!chatId.trim()) throw new Error("Linq chat id is required");
    const url = `https://api.linqapp.com/api/partner/v3/chats/${encodeURIComponent(chatId)}/typing`;
    const response = await fetcher(url, typingRequest(options.apiKey, method));
    if (!response.ok) throw new Error(`Linq typing indicator failed (${response.status})`);
  }
  return {
    startTyping(chatId: string): Promise<void> {
      return setTyping(chatId, "POST");
    },
    stopTyping(chatId: string): Promise<void> {
      return setTyping(chatId, "DELETE");
    },
    async sendReply(chatId: string, reply: LinqReply): Promise<{ messageId: string }> {
      if (!chatId.trim()) throw new Error("Linq chat id is required");
      const response = await fetcher(
        `https://api.linqapp.com/api/partner/v3/chats/${encodeURIComponent(chatId)}/messages`,
        replyRequest(options.apiKey, reply),
      );
      if (!response.ok) throw new Error(`Linq reply failed (${response.status})`);
      return { messageId: messageId(await response.json()) };
    },
  };
}
