declare global {
  interface Window {
    cast: any;
    __onGCastApiAvailable: ((isAvailable: boolean) => void) | undefined;
  }
}

export {};
