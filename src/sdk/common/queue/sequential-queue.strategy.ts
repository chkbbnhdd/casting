import { CastMediaItem, CastQueueState, CastQueueStrategy } from '../types';
import { copyItems, createQueueState, rebuildState, resolveActiveItemId } from '../utils';

export class SequentialQueueStrategy implements CastQueueStrategy {
  readonly strategyName = 'sequential';

  seed(items: CastMediaItem[], activeItemId: string | null = null): CastQueueState {
    const copiedItems = copyItems(items);
    return createQueueState(copiedItems, resolveActiveItemId(copiedItems, activeItemId));
  }

  append(state: CastQueueState, items: CastMediaItem[]): CastQueueState {
    const nextItems = [...copyItems(state.items), ...copyItems(items)];
    return rebuildState(nextItems, resolveActiveItemId(nextItems, state.activeItemId), nextItems.length > 0 ? 'ready' : 'idle');
  }

  replace(state: CastQueueState, items: CastMediaItem[], activeItemId: string | null = null): CastQueueState {
    const nextItems = copyItems(items);
    return rebuildState(nextItems, resolveActiveItemId(nextItems, activeItemId), nextItems.length > 0 ? 'ready' : 'idle');
  }

  select(state: CastQueueState, itemId: string): CastQueueState {
    if (!state.items.some((item) => item.id === itemId)) {
      return state;
    }

    return rebuildState(state.items, itemId, 'playing');
  }

  remove(state: CastQueueState, itemId: string): CastQueueState {
    const nextItems = state.items.filter((item) => item.id !== itemId);
    const nextActiveItemId = resolveActiveItemId(nextItems, state.activeItemId === itemId ? null : state.activeItemId);
    return rebuildState(nextItems, nextActiveItemId, nextItems.length > 0 ? state.status : 'idle');
  }

  move(state: CastQueueState, fromIndex: number, toIndex: number): CastQueueState {
    if (
      fromIndex < 0 ||
      fromIndex >= state.items.length ||
      toIndex < 0 ||
      toIndex >= state.items.length ||
      fromIndex === toIndex
    ) {
      return state;
    }

    const nextItems = copyItems(state.items);
    const [movedItem] = nextItems.splice(fromIndex, 1);
    if (!movedItem) {
      return state;
    }

    nextItems.splice(toIndex, 0, movedItem);
    return rebuildState(nextItems, resolveActiveItemId(nextItems, state.activeItemId), state.status);
  }

  advance(state: CastQueueState): CastQueueState {
    if (state.items.length === 0) {
      return state;
    }

    const currentIndex = state.activeItemId ? state.items.findIndex((item) => item.id === state.activeItemId) : -1;
    const nextIndex = Math.min(Math.max(currentIndex, 0) + 1, state.items.length - 1);
    return rebuildState(state.items, state.items[nextIndex]?.id ?? null, 'playing');
  }

  rewind(state: CastQueueState): CastQueueState {
    if (state.items.length === 0) {
      return state;
    }

    const currentIndex = state.activeItemId ? state.items.findIndex((item) => item.id === state.activeItemId) : 0;
    const nextIndex = Math.max(currentIndex - 1, 0);
    return rebuildState(state.items, state.items[nextIndex]?.id ?? null, 'playing');
  }
}
