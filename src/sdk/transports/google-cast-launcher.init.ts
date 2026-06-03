type CastFrameworkWindow = Window & {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: {
    framework?: {
      CastContext: {
        getInstance: () => {
          setOptions: (options: {
            receiverApplicationId: string;
            autoJoinPolicy: string;
          }) => void;
        };
      };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy?: {
        ORIGIN_SCOPED?: string;
      };
      media?: {
        DEFAULT_MEDIA_RECEIVER_APP_ID?: string;
      };
    };
  };
};

const CAST_SENDER_SCRIPT_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CD17C645';
const CUSTOM_RECEIVER_PAGE_PATH = '/receiver';
const RECEIVER_APP_ID_QUERY_PARAM = 'castAppId';
const ORIGIN_SCOPED_AUTO_JOIN_POLICY = 'origin_scoped';
let initializePromise: Promise<boolean> | null = null;

export type GoogleCastLauncherDiagnostics = {
  currentOrigin: string;
  receiverPageUrl: string;
  receiverAppIdQueryParam: string;
  configuredReceiverApplicationId: string;
  sdkDefaultReceiverApplicationId: string | null;
  effectiveReceiverApplicationId: string;
  receiverPreference: 'custom' | 'default';
  hasCastFramework: boolean;
  hasCastContext: boolean;
  hasApiAvailableCallback: boolean;
  hasCastScriptTag: boolean;
  isCastScriptLoaded: boolean;
};

function getReceiverPreference(castWindow: CastFrameworkWindow): 'custom' | 'default' {
  const requestedPreference = new URLSearchParams(castWindow.location.search).get('castReceiver');
  return requestedPreference === 'default' ? 'default' : 'custom';
}

function getConfiguredReceiverApplicationId(castWindow: CastFrameworkWindow): string {
  const requestedApplicationId = new URLSearchParams(castWindow.location.search).get(RECEIVER_APP_ID_QUERY_PARAM)?.trim();
  return requestedApplicationId || DEFAULT_MEDIA_RECEIVER_APP_ID;
}

function getReceiverPageUrl(castWindow: CastFrameworkWindow): string {
  return new URL(CUSTOM_RECEIVER_PAGE_PATH, castWindow.location.origin).toString();
}

function resolveReceiverApplicationId(castWindow: CastFrameworkWindow): string {
  const sdkDefaultReceiverId = castWindow.chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID;
  const preference = getReceiverPreference(castWindow);

  if (preference === 'default') {
    return sdkDefaultReceiverId ?? 'CC1AD845';
  }

  return getConfiguredReceiverApplicationId(castWindow);
}

function getWindowOrNull(): CastFrameworkWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window as CastFrameworkWindow;
}

function loadCastScriptOnce(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Document is not available in this environment.'));
      return;
    }

    const existingScript =
      document.querySelector<HTMLScriptElement>('script[data-cast-sdk="true"]') ??
      document.querySelector<HTMLScriptElement>('script[src*="cast_sender.js"]');

    if (existingScript) {
      if (existingScript.dataset['loaded'] === 'true') {
        resolve();
        return;
      }

      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Cast sender SDK.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = url;
    script.dataset['castSdk'] = 'true';
    script.addEventListener(
      'load',
      () => {
        script.dataset['loaded'] = 'true';
        resolve();
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error('Failed to load Google Cast sender SDK.')), { once: true });
    document.head.appendChild(script);
  });
}

function applyDefaultCastOptions(castWindow: CastFrameworkWindow): boolean {
  const castContext = castWindow.cast?.framework?.CastContext.getInstance();
  const defaultReceiverId = resolveReceiverApplicationId(castWindow);
  const originScopedPolicy = castWindow.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED ?? ORIGIN_SCOPED_AUTO_JOIN_POLICY;

  if (!castContext) {
    return false;
  }

  try {
    castContext.setOptions({
      receiverApplicationId: defaultReceiverId,
      autoJoinPolicy: originScopedPolicy,
    });
  } catch {
    return false;
  }

  return true;
}

export function initializeGoogleCastLauncher(): Promise<boolean> {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = new Promise<boolean>((resolve) => {
    const castWindow = getWindowOrNull();
    let settled = false;

    const settle = (value: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    if (!castWindow) {
      settle(false);
      return;
    }

    if (applyDefaultCastOptions(castWindow)) {
      settle(true);
      return;
    }

    const previousCallback = castWindow.__onGCastApiAvailable;
    castWindow.__onGCastApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      if (!isAvailable) {
        settle(false);
        return;
      }

      settle(applyDefaultCastOptions(castWindow));
    };

    void loadCastScriptOnce(CAST_SENDER_SCRIPT_URL).catch(() => settle(false));
  });

  return initializePromise;
}

export function getGoogleCastLauncherDiagnostics(): GoogleCastLauncherDiagnostics {
  const castWindow = getWindowOrNull();
  if (!castWindow || typeof document === 'undefined') {
    return {
      currentOrigin: 'n/a',
      receiverPageUrl: CUSTOM_RECEIVER_PAGE_PATH,
      receiverAppIdQueryParam: RECEIVER_APP_ID_QUERY_PARAM,
      configuredReceiverApplicationId: DEFAULT_MEDIA_RECEIVER_APP_ID,
      sdkDefaultReceiverApplicationId: null,
      effectiveReceiverApplicationId: DEFAULT_MEDIA_RECEIVER_APP_ID,
      receiverPreference: 'custom',
      hasCastFramework: false,
      hasCastContext: false,
      hasApiAvailableCallback: false,
      hasCastScriptTag: false,
      isCastScriptLoaded: false,
    };
  }

  const castScript =
    document.querySelector<HTMLScriptElement>('script[data-cast-sdk="true"]') ??
    document.querySelector<HTMLScriptElement>('script[src*="cast_sender.js"]');
  const hasCastContext = Boolean(castWindow.cast?.framework?.CastContext.getInstance());
  const receiverPreference = getReceiverPreference(castWindow);

  return {
    currentOrigin: castWindow.location.origin,
    receiverPageUrl: getReceiverPageUrl(castWindow),
    receiverAppIdQueryParam: RECEIVER_APP_ID_QUERY_PARAM,
    configuredReceiverApplicationId: getConfiguredReceiverApplicationId(castWindow),
    sdkDefaultReceiverApplicationId: castWindow.chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID ?? null,
    effectiveReceiverApplicationId: resolveReceiverApplicationId(castWindow),
    receiverPreference,
    hasCastFramework: Boolean(castWindow.cast?.framework),
    hasCastContext,
    hasApiAvailableCallback: typeof castWindow.__onGCastApiAvailable === 'function',
    hasCastScriptTag: Boolean(castScript),
    isCastScriptLoaded: castScript?.dataset['loaded'] === 'true',
  };
}
