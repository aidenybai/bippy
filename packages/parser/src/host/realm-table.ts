import { z } from "zod";

export type HostValueKind =
  | "undefined"
  | "null"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "function"
  | "object"
  | "any";

export interface HostType {
  kind: HostValueKind;
  interfaceName: string | null;
  isNullable: boolean;
}

export interface HostMember {
  type: HostType;
  /** Resolved for methods whose overloads agree on one return type. */
  returnType: HostType | null;
  /** Declared parameter names of the widest overload; null for non-methods. */
  parameterNames: string[] | null;
  /** The method returns `this` or a list/iterator of the receiver's own element type (`filter(): T[]`). */
  returnsReceiverItems: boolean;
}

export interface HostInterface {
  extendsNames: string[];
  members: Record<string, HostMember>;
  /** The `addEventListener` event map (`HTMLElementEventMap`) whose keys are the events this target dispatches. */
  eventMapName: string | null;
}

export interface HostRealmTable {
  /** Interfaces the global object implements (`Window` in browsers), whose members are globals. */
  globalObjectInterfaces: string[];
  interfaces: Record<string, HostInterface>;
}

export const GLOBAL_INTERFACE_NAME = "globalThis";

export const ANY_TYPE: HostType = { kind: "any", interfaceName: null, isNullable: false };
export const FUNCTION_TYPE: HostType = { kind: "function", interfaceName: null, isNullable: false };
export const GLOBAL_OBJECT_TYPE: HostType = {
  kind: "object",
  interfaceName: GLOBAL_INTERFACE_NAME,
  isNullable: false,
};

export const propertyMember = (type: HostType): HostMember => ({
  type,
  returnType: null,
  parameterNames: null,
  returnsReceiverItems: false,
});

const HOST_VALUE_KINDS = [
  "undefined",
  "null",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "function",
  "object",
  "any",
] as const;

const hostValueKindSchema = z.enum(HOST_VALUE_KINDS);

/** `kind[:Interface][?]`, e.g. `object:HTMLElement?`. */
const encodeType = (type: HostType): string =>
  `${type.kind}${type.interfaceName === null ? "" : `:${type.interfaceName}`}${type.isNullable ? "?" : ""}`;

const hostTypeSchema = z.string().transform((encoded, context): HostType => {
  const isNullable = encoded.endsWith("?");
  const body = isNullable ? encoded.slice(0, -1) : encoded;
  const separator = body.indexOf(":");
  const kind = hostValueKindSchema.safeParse(separator === -1 ? body : body.slice(0, separator));
  if (!kind.success) {
    context.addIssue({ code: "custom", message: `unknown host type "${encoded}"` });
    return z.NEVER;
  }
  return {
    kind: kind.data,
    interfaceName: separator === -1 ? null : body.slice(separator + 1),
    isNullable,
  };
});

/**
 * `type` for properties; `type(param,param)>returnType` for methods, with a
 * trailing `*` when the return carries the receiver's items, e.g.
 * `function(predicate,thisArg)>object:Array*`.
 */
const encodeMember = (member: HostMember): string => {
  const parameters = member.parameterNames === null ? "" : `(${member.parameterNames.join(",")})`;
  const returnType =
    member.returnType === null
      ? ""
      : `>${encodeType(member.returnType)}${member.returnsReceiverItems ? "*" : ""}`;
  return `${encodeType(member.type)}${parameters}${returnType}`;
};

const MEMBER_PATTERN = /^([^(>]+)(?:\(([^)]*)\))?(?:>([^*]+)(\*)?)?$/;

const hostMemberSchema = z.string().transform((encoded, context): HostMember => {
  const malformed = (): never => {
    context.addIssue({ code: "custom", message: `malformed host member "${encoded}"` });
    return z.NEVER;
  };
  const match = MEMBER_PATTERN.exec(encoded);
  if (!match) return malformed();
  const [, type, parameters, returnType, receiverItems] = match;
  const parsedType = hostTypeSchema.safeParse(type);
  const parsedReturn = returnType === undefined ? null : hostTypeSchema.safeParse(returnType);
  if (!parsedType.success || (parsedReturn !== null && !parsedReturn.success)) return malformed();
  return {
    type: parsedType.data,
    returnType: parsedReturn === null ? null : parsedReturn.data,
    parameterNames:
      parameters === undefined ? null : parameters === "" ? [] : parameters.split(","),
    returnsReceiverItems: receiverItems !== undefined,
  };
});

const hostInterfaceSchema = z
  .object({
    extends: z.array(z.string()).default([]),
    members: z.record(z.string(), hostMemberSchema).default({}),
    events: z.string().nullable().default(null),
  })
  .transform((encoded): HostInterface => ({
    extendsNames: encoded.extends,
    members: encoded.members,
    eventMapName: encoded.events,
  }));

const hostRealmTableSchema = z.object({
  globalObjectInterfaces: z.array(z.string()),
  interfaces: z.record(z.string(), hostInterfaceSchema),
});

interface EncodedHostInterface {
  extends?: string[];
  members?: Record<string, string>;
  events?: string;
}

interface EncodedHostRealmTable {
  globalObjectInterfaces: string[];
  interfaces: Record<string, EncodedHostInterface>;
}

export const encodeHostRealmTable = (table: HostRealmTable): EncodedHostRealmTable => {
  const interfaces: Record<string, EncodedHostInterface> = {};
  for (const [name, record] of Object.entries(table.interfaces).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const encoded: EncodedHostInterface = {};
    if (record.extendsNames.length > 0) encoded.extends = record.extendsNames;
    if (record.eventMapName !== null) encoded.events = record.eventMapName;
    const memberNames = Object.keys(record.members).sort();
    if (memberNames.length > 0) {
      encoded.members = Object.fromEntries(
        memberNames.map((memberName) => [memberName, encodeMember(record.members[memberName])]),
      );
    }
    interfaces[name] = encoded;
  }
  return { globalObjectInterfaces: table.globalObjectInterfaces, interfaces };
};

export const decodeHostRealmTable = (json: unknown): HostRealmTable =>
  hostRealmTableSchema.parse(json);
