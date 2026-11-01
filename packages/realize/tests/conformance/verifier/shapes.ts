import type { Shape } from "./types";

const WRAPPER_NAME_PATTERN = /^(?:Memo|ForwardRef|Lazy)\((.*)\)$/;

export const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

const normalizeName = (name: string): string => {
  const unwrapped = WRAPPER_NAME_PATTERN.exec(name)?.[1] ?? name;
  return unwrapped === name ? (name.split(".").pop() ?? name) : normalizeName(unwrapped);
};

export const normalizeShapes = (shapes: Shape[]): Shape[] =>
  shapes.flatMap((shape): Shape[] => {
    if (shape.kind === "text") {
      const text = normalizeText(shape.text);
      return text ? [{ kind: "text", text }] : [];
    }
    if (shape.kind === "component") return [{ kind: "component", name: normalizeName(shape.name) }];
    return [{ kind: "element", tag: shape.tag, children: normalizeShapes(shape.children) }];
  });
