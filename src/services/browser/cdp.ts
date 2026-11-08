export type CdpEvent = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const COMMAND_TIMEOUT_MS = 60_000;

/** Minimal Chrome DevTools Protocol client over Bun's native WebSocket, using flattened target sessions. */
export class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: CdpEvent) => void>();
  closed = false;

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const data = event.data;
      this.onMessage(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer));
    });
    socket.addEventListener('close', () => this.onClose());
  }

  static connect(url: string, timeoutMs = 30_000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      // The connect URL can embed credentials, so it never goes into error messages.
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to the browser after ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket));
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to the browser.'));
      }, { once: true });
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The browser connection is closed.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    if (this.closed) return;
    this.socket.close();
    this.onClose();
  }

  private onMessage(raw: string) {
    let message: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message ?? 'unknown error'}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId };
    for (const listener of this.listeners) listener(event);
  }

  private onClose() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The browser connection closed.'));
    }
    this.pending.clear();
  }
}
