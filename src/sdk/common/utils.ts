import { CastMediaItem, CastQueueState, CastReceiverQueuePayload, CastUiOverrides } from './types';

export function cloneMediaItem(item: CastMediaItem): CastMediaItem {
  return {
    ...item,
    customData: item.customData ? { ...item.customData } : undefined,
  };
}

export function cloneQueueState(state: CastQueueState): CastQueueState {
  return {
    items: state.items.map((item) => cloneMediaItem(item)),
    activeItemId: state.activeItemId,
    status: state.status,
    lastUpdatedIso: state.lastUpdatedIso,
  };
}

export function createQueueState(items: CastMediaItem[], activeItemId: string | null = null): CastQueueState {
  return {
    items: items.map((item) => cloneMediaItem(item)),
    activeItemId,
    status: items.length > 0 ? 'ready' : 'idle',
    lastUpdatedIso: nowIso(),
  };
}

export function createEmptyQueueState(): CastQueueState {
  return {
    items: [],
    activeItemId: null,
    status: 'idle',
    lastUpdatedIso: nowIso(),
  };
}

export function createMediaItem(input: Omit<CastMediaItem, 'id'> & { id?: string }): CastMediaItem {
  return {
    id: input.id ?? `cast-item-${Math.random().toString(36).slice(2, 10)}`,
    title: input.title,
    url: input.url,
    mimeType: input.mimeType,
    posterUrl: input.posterUrl,
    subtitle: input.subtitle,
    description: input.description,
    durationSeconds: input.durationSeconds,
    customData: input.customData ? { ...input.customData } : undefined,
  };
}

export function mergeUiOverrides(base: CastUiOverrides, overrides: Partial<CastUiOverrides>): CastUiOverrides {
  return {
    ...base,
    ...overrides,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function copyItems(items: CastMediaItem[]): CastMediaItem[] {
  return items.map((item) => cloneMediaItem(item));
}

export function resolveActiveItemId(items: CastMediaItem[], preferredActiveId: string | null): string | null {
  if (preferredActiveId && items.some((item) => item.id === preferredActiveId)) {
    return preferredActiveId;
  }

  return items.length > 0 ? items[0]?.id ?? null : null;
}

export function rebuildState(
  items: CastMediaItem[],
  activeItemId: string | null,
  status: CastQueueState['status']
): CastQueueState {
  return {
    items: copyItems(items),
    activeItemId,
    status,
    lastUpdatedIso: nowIso(),
  };
}

export function createReceiverQueuePayload(state: CastQueueState): CastReceiverQueuePayload {
  return {
    queue: cloneQueueState(state),
    sentAtIso: nowIso(),
  };
}

export function createSerializableQueuePayload(state: CastQueueState): Record<string, unknown> {
  // Create a JSON-serializable queue payload for transmission (no Image objects or complex types)
  return {
    queue: {
      items: state.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        mimeType: item.mimeType,
        posterUrl: item.posterUrl,
        subtitle: item.subtitle,
        description: item.description,
        durationSeconds: item.durationSeconds,
        customData: item.customData,
      })),
      activeItemId: state.activeItemId,
      status: state.status,
      lastUpdatedIso: state.lastUpdatedIso,
    },
    sentAtIso: nowIso(),
  };
}
