import {
  getCapturedDate,
  getCapturedExportReference,
  getCapturedPromise,
  getOpaqueCaptureDescription,
} from "../observations.js";
import type {
  CapturedExportReference,
  CapturedValue,
  StaticObjectEntry,
  StaticValue,
} from "../types.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  listValue,
  nativeObjectValue,
  objectValue,
  primitiveValue,
  thrownValue,
  unknownValue,
} from "./values.js";

/** Evaluates the module export a captured node referenced; null when the module is not part of the analyzed project. */
interface CapturedExportResolver {
  (reference: CapturedExportReference): StaticValue | null;
}

const NO_EXPORTS: CapturedExportResolver = () => null;

/** A value serialized whole from a running page: every key is known, and nodes JSON could not carry stay unknown. */
export const capturedValue = (
  captured: CapturedValue,
  name: string,
  resolveExport: CapturedExportResolver = NO_EXPORTS,
): StaticValue => {
  if (captured === null || typeof captured !== "object") return primitiveValue(captured);
  if (Array.isArray(captured)) {
    return listValue(
      captured.map((item, index) => capturedValue(item, `${name}[${index}]`, resolveExport)),
    );
  }
  const opaque = getOpaqueCaptureDescription(captured);
  if (opaque !== null) return unknownValue(`${name}: ${opaque} recorded from the page`);
  const date = getCapturedDate(captured);
  if (date !== null) return nativeObjectValue(date, null);
  const settlement = getCapturedPromise(captured);
  if (settlement !== null) {
    const outcome = capturedValue(settlement.outcome, name, resolveExport);
    return resolvedPromiseValue(
      settlement.isFulfilled
        ? outcome
        : thrownValue(`${name}: promise rejected on the page`, outcome),
    );
  }
  const reference = getCapturedExportReference(captured);
  if (reference !== null) {
    return (
      resolveExport(reference) ??
      unknownValue(
        `${name}: export "${reference.name}" of ${reference.module} recorded from the page`,
      )
    );
  }
  return objectValue(
    Object.entries(captured).map(([key, item]): StaticObjectEntry => ({
      kind: "property",
      key,
      value: capturedValue(item, `${name}.${key}`, resolveExport),
    })),
  );
};
