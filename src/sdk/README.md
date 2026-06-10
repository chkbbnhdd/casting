# Cast SDK

This folder contains a platform-agnostic sender SDK built around a transport interface.

## How It Works

The SDK is split into 3 layers:

1. Core state and queue logic
- `common/client/cast-sender.client.ts` (`CastSenderClient`)
- `common/queue/sequential-queue.strategy.ts`
- `common/types.ts` and `common/utils.ts`

2. Transport abstraction
- `CastTransport` in `common/types.ts`
- The core client calls `connect`, `loadQueue`, `play`, `pause`, `stop`, `disconnect` through this interface.

3. Concrete transports
- `GoogleCastTransport` (`transports/google-cast.transport.ts`) for web Google Cast sender SDK.
- `MockCastTransport` (`transports/mock-cast.transport.ts`) for local/testing fallback.
- `HybridCastTransport` (`transports/hybrid-cast.transport.ts`) chooses web transport when available and falls back safely.

Because the core only depends on `CastTransport`, you can plug in a platform-specific transport for iOS and Android.

## Platform Support

## Web

Use `GoogleCastTransport` directly, or `HybridCastTransport` if you want automatic fallback:

```ts
import { CastSenderClient, HybridCastTransport } from '../sdk';

const client = new CastSenderClient(new HybridCastTransport());
await client.connect();
```

`GoogleCastTransport` uses the web sender SDK script:
- `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`

## iOS and Android

For native apps, keep using `CastSenderClient` and implement your own transport that bridges to:
- iOS: Google Cast iOS Sender SDK
- Android: Google Cast Android Sender SDK

The core queue/state logic remains unchanged.

### Minimal Custom Transport Shape

```ts
import { CastMediaItem, CastQueueState, CastTransport } from './common/types';

export class NativeBridgeCastTransport implements CastTransport {
  readonly name = 'Native bridge cast transport';
  readonly isSupported = true;

  async connect(state: CastQueueState): Promise<void> {
    // Call native bridge method to open/select cast session
  }

  async loadQueue(state: CastQueueState): Promise<void> {
    // Send serialized queue to native layer and invoke load media
  }

  async play(item: CastMediaItem, state: CastQueueState): Promise<void> {
    // Instruct native SDK to play selected item
  }

  async pause(state: CastQueueState): Promise<void> {
    // Pause via native SDK
  }

  async stop(state: CastQueueState): Promise<void> {
    // Stop via native SDK
  }

  async disconnect(): Promise<void> {
    // End native cast session
  }
}
```

Then:

```ts
import { CastSenderClient } from './common/client/cast-sender.client';

const client = new CastSenderClient(new NativeBridgeCastTransport());
```

## Queue Payload Contract

The queue payload sent to receiver-oriented transports is JSON-serializable and built by:
- `createSerializableQueuePayload(...)` in `common/utils.ts`

Each item includes:
- `id`, `title`, `url`, `mimeType`, optional metadata and `customData`

For cross-platform consistency, keep `customData` schema stable between sender and receiver.

## Implementation Notes

1. Keep platform code in transports
- Avoid putting platform checks in `CastSenderClient`.

2. Prefer bridge transports on native
- iOS/Android should map transport calls to native sender SDK APIs.

3. Error handling
- Throw errors from transport methods; `CastSenderClient` normalizes and surfaces them via `state.lastError`.

4. UI independence
- UI labels are customizable via `updateUiOverrides(...)` and do not affect transport behavior.
