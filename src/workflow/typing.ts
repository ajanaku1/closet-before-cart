export interface TypingGateway {
  readonly startTyping: (chatId: string) => Promise<void>;
  readonly stopTyping: (chatId: string) => Promise<void>;
}

export interface TypingScheduler {
  readonly every: (callback: () => void, milliseconds: number) => unknown;
  readonly cancel: (timer: unknown) => void;
}

const defaultScheduler: TypingScheduler = {
  every(callback, milliseconds) {
    return setInterval(callback, milliseconds);
  },
  cancel(timer) {
    clearInterval(timer as ReturnType<typeof setInterval>);
  },
};

async function ignoreFailure(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch {
    // Typing is best-effort UX and must never block the actual response.
  }
}

export async function runWithTyping<Result>(
  chatId: string,
  operation: () => Promise<Result>,
  gateway: TypingGateway,
  scheduler: TypingScheduler = defaultScheduler,
): Promise<Result> {
  await ignoreFailure(gateway.startTyping(chatId));
  const timer = scheduler.every(() => {
    void ignoreFailure(gateway.startTyping(chatId));
  }, 60_000);
  try {
    return await operation();
  } finally {
    scheduler.cancel(timer);
    await ignoreFailure(gateway.stopTyping(chatId));
  }
}
