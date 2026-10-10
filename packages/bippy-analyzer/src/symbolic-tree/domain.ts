import { TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { Node } from "typescript/unstable/ast";
import type { Domain } from "./model.ts";

const FALSY_CASES = new Set(["false", "null", "undefined", "0", '""', "void", "0n"]);
const UNDECIDED_CASES = new Set(["string", "number", "bigint", "boolean"]);

export const getCaseTruthiness = (caseText: string): "truthy" | "falsy" | "either" => {
  if (FALSY_CASES.has(caseText)) return "falsy";
  if (UNDECIDED_CASES.has(caseText)) return "either";
  return "truthy";
};

export const getDomainOfType = (checker: Checker, type: Type | undefined): Domain => {
  if (!type || type.isErrorType()) return { kind: "unknown", reason: "unresolved-type" };
  if (type.flags & TypeFlags.Any) return { kind: "unknown", reason: "any" };
  if (type.flags & TypeFlags.Unknown) return { kind: "unknown", reason: "unknown-type" };
  if (type.flags & TypeFlags.Never) return { kind: "unknown", reason: "never" };
  if (type.isUnionType()) {
    const memberTexts = type.getTypes().map((member) => checker.typeToString(member));
    return { kind: "cases", cases: [...new Set(memberTexts)], origin: "type" };
  }
  if (type.isLiteralType() || type.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
    return { kind: "cases", cases: [checker.typeToString(type)], origin: "type" };
  }
  return { kind: "opaque", typeText: checker.typeToString(type) };
};

export const getDomainAtNode = (checker: Checker, node: Node): Domain =>
  getDomainOfType(checker, checker.getTypeAtLocation(node));

export const formatDomain = (domain: Domain): string => {
  if (domain.kind === "cases")
    return domain.cases.join(" | ") + (domain.origin === "type" ? "" : `  (${domain.origin})`);
  if (domain.kind === "opaque") return domain.typeText;
  return `Unknown(${domain.reason})`;
};
