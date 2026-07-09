import { vi } from "vitest";

export interface FakeWebSocketInstance {
  url: string;
  protocol: string | undefined;
  sentMessages: string[];
  didClose: boolean;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send: (message: string) => void;
  close: () => void;
}

export const installFakeWebSocket = (): FakeWebSocketInstance[] => {
  const instances: FakeWebSocketInstance[] = [];
  class FakeWebSocket implements FakeWebSocketInstance {
    url: string;
    protocol: string | undefined;
    sentMessages: string[] = [];
    didClose = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string, protocol?: string) {
      this.url = url;
      this.protocol = protocol;
      instances.push(this);
    }
    send(message: string) {
      this.sentMessages.push(message);
    }
    close() {
      this.didClose = true;
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return instances;
};
