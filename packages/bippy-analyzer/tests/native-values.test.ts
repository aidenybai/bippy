import { Window } from "happy-dom";
import { describe, expect, it } from "vite-plus/test";
import { setNativeObjectMember } from "../src/evaluate/native-values.js";
import { nativeObjectValue, objectValue } from "../src/evaluate/values.js";

describe("native object values", () => {
  it("widens host objects when a WebIDL setter rejects a structurally lowered value", () => {
    const audio = new Window().document.createElement("audio");
    const value = nativeObjectValue(audio, null);
    expect(() => setNativeObjectMember(value, "srcObject", objectValue())).not.toThrow();
  });
});
