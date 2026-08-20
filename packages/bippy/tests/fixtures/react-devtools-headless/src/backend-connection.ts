export interface DevToolsWebSocket {
  CLOSED: number;
  OPEN: number;
  onclose?: () => void;
  onopen?: () => void;
  readyState: number;
  send: (message: string) => void;
}

export interface BackendConnection {
  disconnect: () => void;
}

export interface BackendConnectionOptions {
  onShutdown: () => void;
  websocket: DevToolsWebSocket;
}

export const connectToDevTools = ({
  onShutdown,
  websocket,
}: BackendConnectionOptions): BackendConnection => {
  let isShutdown = false;
  const disconnect = (): void => {
    if (isShutdown) return;
    isShutdown = true;
    onShutdown();
  };
  websocket.onclose = disconnect;
  websocket.onopen = () => {
    if (websocket.readyState === websocket.OPEN) websocket.send("attach");
  };
  return { disconnect };
};
