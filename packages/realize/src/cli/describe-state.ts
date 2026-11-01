import type { SymbolicValue } from "../core/types";
import type { SourceReader } from "../core/labels/source-text";
import { truncate } from "../core/labels/text";

export interface StateDescriber {
  file: string;
  sourceReader: SourceReader;
}

type UnknownValue = Extract<SymbolicValue, { kind: "Unknown" }>;

const MAX_UNKNOWN_WIDTH = 40;

export const describeUnknown = (node: UnknownValue, describer: StateDescriber): string => {
  const source = describer.sourceReader.read(describer.file, node.loc);
  return `⚠ ${source ? truncate(source, MAX_UNKNOWN_WIDTH) : `Unknown(${node.reason})`}`;
};
