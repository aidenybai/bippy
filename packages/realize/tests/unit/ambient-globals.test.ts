import { describe, expect, it } from "vite-plus/test";
import { createAmbientGlobalPlugin } from "../conformance/verifier/harness/stand-ins";

const transformAmbient = (code: string): string | null => {
  const plugin = createAmbientGlobalPlugin();
  const transform = plugin.transform;
  if (typeof transform !== "function") throw new Error("ambient plugin has no transform hook");
  const result = Reflect.apply(transform, plugin, [code, "/app/src/component.tsx"]);
  return result === null ? null : result.code;
};

describe("ambient globals", () => {
  it("imports a stand-in for each name the module declares ambiently", () => {
    const code = [
      "declare function send(message: string): void;",
      "declare const config: { url: string };",
      "declare global { var analytics: unknown; function track(): void; }",
      "export const handle = () => send(config.url);",
    ].join("\n");
    expect(transformAmbient(code)).toBe(
      `${code}\nimport ${JSON.stringify("\0bippy-verify-ambient-globals:send,config,analytics,track")};\n`,
    );
  });

  it("leaves overload signatures and modules without ambient values alone", () => {
    expect(
      transformAmbient(
        "declare type Id = string;\nexport function pick(id: Id): Id;\nexport function pick(id: Id) { return id; }",
      ),
    ).toBeNull();
  });

  it("loads a module that assigns the stand-in only to globals that are missing", () => {
    const plugin = createAmbientGlobalPlugin();
    const load = plugin.load;
    if (typeof load !== "function") throw new Error("ambient plugin has no load hook");
    const source = Reflect.apply(load, plugin, ["\0bippy-verify-ambient-globals:send,track"]);
    expect(source).toContain("globalThis.send ??= STAND_IN;");
    expect(source).toContain("globalThis.track ??= STAND_IN;");
  });
});
