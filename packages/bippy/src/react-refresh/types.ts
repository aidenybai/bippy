export interface HmrUpdateHandler {
  (filePaths: string[]): void;
}

export interface HmrTransport {
  dispose: () => void;
}
