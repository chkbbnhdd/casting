export interface SessionContext {
  accessToken: string | null;
  idToken: string | null;
  segments: string[];
  anonymousId: string | null;
}

export interface SessionUpdateMessage {
  type: 'sessionUpdate';
  auth: {
    accessToken: string;
    idToken: string;
  };
  segments: string[];
  tracking: {
    anonymousId: string;
  };
}
