import { EventEmitter } from "./event-emitter.js";

export interface WallMessage {
  event?: unknown;
  payload?: unknown;
}

export interface Wall {
  listen: (listener: (message: unknown) => void) => (() => void) | undefined;
  send: (event: string, payload: unknown) => void;
}

interface QueuedMessage {
  event: string;
  payload: unknown;
}

export class Bridge extends EventEmitter {
  private isShutdown = false;
  private readonly messageQueue: QueuedMessage[] = [];
  private scheduledFlush = false;
  private wallUnlisten: (() => void) | null;

  constructor(readonly wall: Wall) {
    super();
    const wallUnlisten = wall.listen(this.handleMessage);
    if (typeof wallUnlisten !== "function") {
      throw new TypeError("Wall.listen() must return an unlisten function.");
    }
    this.wallUnlisten = wallUnlisten;
  }

  override addListener(event: string, listener: (...arguments_: unknown[]) => unknown): void {
    this.assertNotShutdown("add a listener");
    super.addListener(event, listener);
  }

  override emit(event: string, ...arguments_: unknown[]): void {
    this.assertNotShutdown("emit an event");
    super.emit(event, ...arguments_);
  }

  send(event: string, payload?: unknown): void {
    this.assertNotShutdown("send a message");
    if (event.length === 0) throw new TypeError("Bridge event names must be non-empty strings.");
    this.messageQueue.push({ event, payload });
    if (this.scheduledFlush) return;
    this.scheduledFlush = true;
    queueMicrotask(this.flush);
  }

  shutdown(): void {
    this.assertNotShutdown("shut down");
    this.emit("shutdown");
    this.send("shutdown");
    this.isShutdown = true;
    this.removeAllListeners();
    const wallUnlisten = this.wallUnlisten;
    this.wallUnlisten = null;
    try {
      wallUnlisten?.();
    } finally {
      do this.flush();
      while (this.messageQueue.length > 0);
    }
  }

  private readonly assertNotShutdown = (action: string): void => {
    if (this.isShutdown) {
      throw new Error(`Cannot ${action} through a Bridge that has been shut down.`);
    }
  };

  private readonly flush = (): void => {
    try {
      for (const message of this.messageQueue) this.wall.send(message.event, message.payload);
      this.messageQueue.length = 0;
    } finally {
      this.scheduledFlush = false;
    }
  };

  private readonly handleMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null || !("event" in message)) return;
    const event = Reflect.get(message, "event");
    if (typeof event !== "string" || event.length === 0) {
      throw new TypeError("Bridge event names must be non-empty strings.");
    }
    this.assertNotShutdown("receive a message");
    this.emit(event, Reflect.get(message, "payload"));
  };
}
