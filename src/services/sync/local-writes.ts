type Listener = (path: string) => void;

const listeners = new Set<Listener>();

/** Lets config sync hear about local writes without the writers importing the sync service. */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyLocalWrite(path: string): void {
  for (const listener of listeners) listener(path);
}
