import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import type {
  Guard,
  GuardLiteral,
  InputSourceKind,
  InputVariable,
  SymbolicCardinality,
  SymbolicPredicate,
  SymbolicVariable,
} from "./guards.js";

const inputSourceKindSchema: z.ZodType<InputSourceKind> = z.enum([
  "fetch",
  "loader",
  "database",
  "environment",
  "feature-flag",
  "viewport",
  "clock",
  "random",
  "storage",
  "location",
  "state",
  "commit",
  "root-props",
  "collection",
  "flight",
  "path",
  "unknown",
]);

export const inputVariableSchema: z.ZodType<InputVariable> = z.object({
  id: z.string(),
  label: z.string(),
  source: inputSourceKindSchema,
  location: z.string().nullable(),
});

export const symbolicVariableSchema: z.ZodType<SymbolicVariable> = z.object({
  input: z.string(),
  path: z.array(z.string()),
  measure: z.enum(["value", "length", "typeof", "choice"]),
});

const guardLiteralSchema: z.ZodType<GuardLiteral> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const guardSchema: z.ZodType<Guard> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("constant"), value: z.boolean() }),
    z.object({ kind: z.literal("truthy"), variable: symbolicVariableSchema }),
    z.object({
      kind: z.literal("eq"),
      variable: symbolicVariableSchema,
      value: guardLiteralSchema,
    }),
    z.object({
      kind: z.literal("compare"),
      variable: symbolicVariableSchema,
      operator: z.enum(["<", "<=", ">", ">="]),
      value: z.number(),
    }),
    z.object({
      kind: z.literal("in-set"),
      variable: symbolicVariableSchema,
      values: z.array(guardLiteralSchema),
    }),
    z.object({ kind: z.literal("not"), operand: guardSchema }),
    z.object({ kind: z.literal("and"), operands: z.array(guardSchema) }),
    z.object({ kind: z.literal("or"), operands: z.array(guardSchema) }),
  ]),
);

export const symbolicPredicateSchema: z.ZodType<SymbolicPredicate> = z.object({
  formula: guardSchema.nullable(),
  choice: symbolicVariableSchema.nullable(),
  guards: z.array(guardSchema).nullable().default(null),
  inputs: z.array(inputVariableSchema),
});

export const symbolicCardinalitySchema: z.ZodType<SymbolicCardinality> = z.object({
  variable: symbolicVariableSchema,
  inputs: z.array(inputVariableSchema),
});

export const serializeSymbolicPredicate = (predicate: SymbolicPredicate): string =>
  JSON.stringify(predicate);

export const parseSymbolicPredicate = (serialized: string): SymbolicPredicate =>
  parseWithSchema(symbolicPredicateSchema, JSON.parse(serialized), "branch predicate");

export const serializeSymbolicCardinality = (cardinality: SymbolicCardinality): string =>
  JSON.stringify(cardinality);

export const parseSymbolicCardinality = (serialized: string): SymbolicCardinality =>
  parseWithSchema(symbolicCardinalitySchema, JSON.parse(serialized), "repeat cardinality");
