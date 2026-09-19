import type { StaticValue } from "../types.js";
import { nativeFunction, noopFunction } from "./stubs.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  UNDEFINED_VALUE,
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const createAudioParam = (): StaticValue =>
  objectFromRecord({
    value: primitiveValue(1),
    cancelAndHoldAtTime: noopFunction("cancelAndHoldAtTime"),
    cancelScheduledValues: noopFunction("cancelScheduledValues"),
    exponentialRampToValueAtTime: noopFunction("exponentialRampToValueAtTime"),
    linearRampToValueAtTime: noopFunction("linearRampToValueAtTime"),
    setTargetAtTime: noopFunction("setTargetAtTime"),
    setValueAtTime: noopFunction("setValueAtTime"),
    setValueCurveAtTime: noopFunction("setValueCurveAtTime"),
  });

const createAudioNode = (properties: Record<string, StaticValue> = {}): StaticValue =>
  objectFromRecord({
    connect: nativeFunction("connect", ([destination]) => destination ?? UNDEFINED_VALUE),
    disconnect: noopFunction("disconnect"),
    ...properties,
  });

const createWorkletPort = (): StaticValue =>
  objectFromRecord({
    onmessage: UNDEFINED_VALUE,
    postMessage: noopFunction("postMessage"),
    start: noopFunction("start"),
    close: noopFunction("close"),
  });

export const createAudioWorkletNode = (): StaticValue =>
  createAudioNode({ port: createWorkletPort() });

export const createAudioContext = (options: StaticValue | undefined): StaticValue => {
  const configuredSampleRate =
    options?.kind === "object" ? getObjectProperty(options, "sampleRate") : UNDEFINED_VALUE;
  const sampleRate =
    configuredSampleRate.kind === "primitive" && configuredSampleRate.value === undefined
      ? primitiveValue(44_100)
      : configuredSampleRate;
  const resolvedUndefined = (): StaticValue => resolvedPromiseValue(UNDEFINED_VALUE);
  return objectFromRecord({
    state: unknownPrimitiveValue("string", "AudioContext state"),
    sampleRate,
    currentTime: unknownPrimitiveValue("number", "AudioContext current time"),
    destination: createAudioNode(),
    audioWorklet: objectFromRecord({
      addModule: nativeFunction("addModule", resolvedUndefined),
    }),
    addEventListener: noopFunction("addEventListener"),
    removeEventListener: noopFunction("removeEventListener"),
    resume: nativeFunction("resume", resolvedUndefined),
    suspend: nativeFunction("suspend", resolvedUndefined),
    close: nativeFunction("close", resolvedUndefined),
    createAnalyser: nativeFunction("createAnalyser", () =>
      createAudioNode({
        fftSize: primitiveValue(2048),
        smoothingTimeConstant: primitiveValue(0.8),
      }),
    ),
    createGain: nativeFunction("createGain", () =>
      createAudioNode({ gain: createAudioParam() }),
    ),
    createMediaStreamDestination: nativeFunction("createMediaStreamDestination", () =>
      createAudioNode({ stream: unknownValue("MediaStream from audio destination") }),
    ),
    createMediaStreamSource: nativeFunction("createMediaStreamSource", () => createAudioNode()),
    createMediaElementSource: nativeFunction("createMediaElementSource", () => createAudioNode()),
    createBufferSource: nativeFunction("createBufferSource", () =>
      createAudioNode({
        buffer: UNDEFINED_VALUE,
        playbackRate: createAudioParam(),
        start: noopFunction("start"),
        stop: noopFunction("stop"),
      }),
    ),
    decodeAudioData: nativeFunction("decodeAudioData", () =>
      resolvedPromiseValue(unknownValue("decoded AudioBuffer")),
    ),
  });
};
