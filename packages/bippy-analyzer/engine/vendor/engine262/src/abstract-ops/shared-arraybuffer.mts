export function sharedArrayBufferNotSupported(): never {
  throw new Error('SharedArrayBuffer is not supported');
}

/** https://tc39.es/ecma262/#sec-isgrowablesharedarraybuffer */
export function IsGrowableSharedArrayBuffer(_object: unknown): boolean {
  return false;
}
