export const UI_FRIENDLY_BATCH_SIZE = 200;

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('Operation was aborted.');
  error.name = 'AbortError';
  throw error;
}

export async function forEachInYieldingBatches<T>(
  items: Iterable<T>,
  visit: (item: T, index: number) => void,
  signal?: AbortSignal,
  batchSize = UI_FRIENDLY_BATCH_SIZE,
): Promise<void> {
  let index = 0;
  for (const item of items) {
    throwIfAborted(signal);
    visit(item, index);
    index += 1;

    if (index % batchSize === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  throwIfAborted(signal);
}
