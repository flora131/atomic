export interface QueueDispatchOptions {
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => void;
  shouldDispatch?: () => boolean;
}

const DEFAULT_QUEUE_DISPATCH_DELAY_MS = 50;

export function invalidateActiveStreamGeneration(currentGeneration: number): number {
  return currentGeneration + 1;
}

export function isCurrentStreamCallback(
  activeGeneration: number,
  callbackGeneration: number,
): boolean {
  return activeGeneration === callbackGeneration;
}

export function dispatchNextQueuedMessage<T>(
  dequeue: () => T | undefined,
  dispatch: (message: T) => void,
  options?: QueueDispatchOptions,
): boolean {
  const delayMs = options?.delayMs ?? DEFAULT_QUEUE_DISPATCH_DELAY_MS;
  const schedule = options?.schedule ?? ((callback: () => void, delay: number) => {
    setTimeout(callback, delay);
  });

  // Legacy fast-path: preserve return semantics when no guard is needed.
  if (!options?.shouldDispatch) {
    const nextMessage = dequeue();
    if (!nextMessage) {
      return false;
    }

    schedule(() => {
      dispatch(nextMessage);
    }, delayMs);

    return true;
  }

  schedule(() => {
    if (!options.shouldDispatch?.()) {
      return;
    }
    const nextMessage = dequeue();
    if (!nextMessage) {
      return;
    }
    dispatch(nextMessage);
  }, delayMs);

  return true;
}
