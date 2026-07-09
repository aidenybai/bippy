import type { FiberRoot, ReactRefreshUpdate } from "../types.js";

export interface HmrUpdateHandler {
  (filePaths: string[]): void;
}

export interface HmrTransport {
  dispose: () => void;
}

export interface ReactRefreshUpdateHandler {
  (update: ReactRefreshUpdate, root: FiberRoot): void;
}

export interface ReactRefreshListener {
  dispose: () => void;
}
