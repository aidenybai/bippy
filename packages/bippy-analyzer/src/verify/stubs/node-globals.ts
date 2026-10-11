/**
 * Node globals that browser bundles of server-leaning code read at import time. They only
 * need to exist for modules to load; nothing here is meant to behave like Node.
 */
class BufferShim {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static from(value: string | ArrayLike<number>, encoding?: string): BufferShim {
    if (typeof value !== "string") return new BufferShim(Uint8Array.from(value));
    const binary = encoding === "base64" ? atob(value) : value;
    return new BufferShim(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof BufferShim;
  }

  get length(): number {
    return this.bytes.length;
  }

  toString(encoding?: string): string {
    const binary = String.fromCharCode(...this.bytes);
    return encoding === "base64" ? btoa(binary) : binary;
  }
}

Object.assign(globalThis, {
  global: globalThis,
  __dirname: "/",
  __filename: "/index.js",
  Buffer: Reflect.get(globalThis, "Buffer") ?? BufferShim,
});
