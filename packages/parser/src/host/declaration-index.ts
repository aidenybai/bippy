import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  Class,
  Declaration,
  Directive,
  Expression,
  Function,
  Statement,
  TSInterfaceDeclaration,
  TSLiteral,
  TSModuleBlock,
  TSModuleDeclaration,
  TSSignature,
  TSType,
  TSTypeName,
  TSTypeQueryExprName,
  VariableDeclaration,
} from "oxc-parser";
import { parseSync } from "oxc-parser";
import {
  ANY_TYPE,
  FUNCTION_TYPE,
  GLOBAL_INTERFACE_NAME,
  GLOBAL_OBJECT_TYPE,
  type HostInterface,
  type HostMember,
  type HostRealmTable,
  type HostType,
  type HostValueKind,
} from "./realm-table.js";

type MemberDeclaration =
  | { form: "property"; type: TSType | null }
  | { form: "method"; returnType: TSType | null }
  | { form: "class"; interfaceName: string }
  | { form: "namespace"; interfaceName: string };

interface InterfaceRecord {
  extendsNames: string[];
  members: Map<string, MemberDeclaration[]>;
  isCallable: boolean;
}

const NAMESPACE_PREFIX = "namespace ";

const REFERENCE_DIRECTIVE = /^\/\/\/\s*<reference\s+(lib|path)="([^"]+)"/gm;

const keywordType = (kind: HostValueKind): HostType => ({
  kind,
  interfaceName: null,
  isNullable: false,
});

const getSignatureName = (signature: TSSignature): string | null => {
  if (signature.type !== "TSPropertySignature" && signature.type !== "TSMethodSignature")
    return null;
  if (signature.computed) return null;
  const { key } = signature;
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
};

const getQualifiedName = (typeName: TSTypeName): string | null => {
  if (typeName.type === "Identifier") return typeName.name;
  if (typeName.type === "ThisExpression") return null;
  const left = getQualifiedName(typeName.left);
  return left === null ? null : `${left}.${typeName.right.name}`;
};

const getExpressionName = (expression: Expression): string | null => {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type !== "MemberExpression" || expression.computed) return null;
  const objectName = getExpressionName(expression.object);
  return objectName === null ? null : `${objectName}.${expression.property.name}`;
};

const getLiteralKind = (literal: TSLiteral): HostValueKind => {
  switch (literal.type) {
    case "TemplateLiteral":
      return "string";
    case "UnaryExpression":
      return "number";
    case "Literal":
      break;
  }
  const { value } = literal;
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return typeof value;
    default:
      return "any";
  }
};

const isGlobalThisQuery = (type: TSType): boolean =>
  type.type === "TSTypeQuery" &&
  type.exprName.type === "Identifier" &&
  type.exprName.name === GLOBAL_INTERFACE_NAME;

const sameType = (left: HostType, right: HostType): boolean =>
  left.kind === right.kind &&
  left.interfaceName === right.interfaceName &&
  left.isNullable === right.isNullable;

/**
 * Value declarations read from `.d.ts` files the way the type checker reads
 * `lib.*.d.ts` and `@types/*`: interfaces merge, `declare global` blocks and
 * top-level declarations contribute to `globalThis`, namespaces become objects
 * and `/// <reference>` directives pull in their targets. Only value shapes are
 * resolved: which `typeof` a member has and which interface it implements.
 * Runs at build time; `toTable()` is what ships.
 */
export class HostDeclarationIndex {
  private readonly interfaces = new Map<string, InterfaceRecord>();
  private readonly aliases = new Map<string, TSType>();
  private readonly loadedFiles = new Set<string>();
  private readonly memberCache = new Map<string, HostMember | null>();
  /** Interfaces a `declare var x: X & typeof globalThis` names: the global object implements them (`Window`). */
  private readonly globalObjectInterfaces = new Set<string>();

  /** `libDirectory` holds TypeScript's `lib.*.d.ts` files that `/// <reference lib>` directives name. */
  constructor(private readonly libDirectory: string) {}

  addFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (this.loadedFiles.has(resolved)) return;
    this.loadedFiles.add(resolved);
    const sourceText = readFileSync(resolved, "utf8");
    for (const [, directive, target] of sourceText.matchAll(REFERENCE_DIRECTIVE)) {
      this.addFile(
        directive === "lib"
          ? path.join(this.libDirectory, `lib.${target}.d.ts`)
          : path.resolve(path.dirname(resolved), target),
      );
    }
    this.addSource(resolved, sourceText);
  }

  addSource(fileName: string, sourceText: string): void {
    const { program } = parseSync(fileName, sourceText, {
      lang: "ts",
      sourceType: "module",
      astType: "ts",
    });
    this.addStatements(program.body, GLOBAL_INTERFACE_NAME);
    this.memberCache.clear();
  }

  toTable(): HostRealmTable {
    const interfaces: Record<string, HostInterface> = {};
    for (const [interfaceName, record] of this.interfaces) {
      const members: Record<string, HostMember> = {};
      for (const [memberName, declarations] of record.members) {
        members[memberName] = this.resolveDeclarations(interfaceName, declarations);
      }
      interfaces[interfaceName] = { extendsNames: record.extendsNames, members };
    }
    return { globalObjectInterfaces: [...this.globalObjectInterfaces], interfaces };
  }

  private getGlobal(name: string): HostMember | null {
    let member: HostMember | null = { type: GLOBAL_OBJECT_TYPE, returnType: null };
    for (const key of name.split(".")) {
      const interfaceName: string | null = member.type.interfaceName;
      if (interfaceName === null) return null;
      member =
        interfaceName === GLOBAL_INTERFACE_NAME
          ? this.getGlobalObjectMember(key)
          : this.getMember(interfaceName, key);
      if (member === null) return null;
    }
    return member;
  }

  private getMember(interfaceName: string, memberName: string): HostMember | null {
    const cacheKey = `${interfaceName}\0${memberName}`;
    const cached = this.memberCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const declarations = this.findDeclarations(interfaceName, memberName, new Set());
    const member = declarations ? this.resolveDeclarations(interfaceName, declarations) : null;
    this.memberCache.set(cacheKey, member);
    return member;
  }

  private isGlobalObjectType(type: HostType): boolean {
    return (
      type.interfaceName !== null &&
      (type.interfaceName === GLOBAL_INTERFACE_NAME ||
        this.globalObjectInterfaces.has(type.interfaceName))
    );
  }

  /** The interface the global object implements declares its members more precisely than the bare `var` duplicates. */
  private getGlobalObjectMember(key: string): HostMember | null {
    if (key === GLOBAL_INTERFACE_NAME) return { type: GLOBAL_OBJECT_TYPE, returnType: null };
    for (const interfaceName of this.globalObjectInterfaces) {
      const member = this.getMember(interfaceName, key);
      if (member) return member;
    }
    return this.getMember(GLOBAL_INTERFACE_NAME, key);
  }

  private getOrCreateInterface(name: string): InterfaceRecord {
    let record = this.interfaces.get(name);
    if (!record) {
      record = { extendsNames: [], members: new Map(), isCallable: false };
      this.interfaces.set(name, record);
    }
    return record;
  }

  private addMember(interfaceName: string, memberName: string, declaration: MemberDeclaration) {
    const record = this.getOrCreateInterface(interfaceName);
    const existing = record.members.get(memberName);
    if (existing) existing.push(declaration);
    else record.members.set(memberName, [declaration]);
  }

  private addStatements(statements: (Statement | Directive)[], scope: string): void {
    const isNamespace = scope !== GLOBAL_INTERFACE_NAME;
    for (const statement of statements) {
      if (statement.type === "ExportNamedDeclaration") {
        if (isNamespace && statement.declaration) {
          this.addDeclaration(statement.declaration, scope);
        }
      } else {
        this.addDeclaration(statement, scope);
      }
    }
  }

  private addDeclaration(node: Statement | Directive | Declaration, scope: string): void {
    switch (node.type) {
      case "TSInterfaceDeclaration":
        this.addInterface(node, scope);
        return;
      case "TSTypeAliasDeclaration":
        this.aliases.set(this.qualify(scope, node.id.name), node.typeAnnotation);
        return;
      case "VariableDeclaration":
        this.addVariables(node, scope);
        return;
      case "FunctionDeclaration":
      case "TSDeclareFunction":
        this.addFunction(node, scope);
        return;
      case "ClassDeclaration":
        this.addClass(node, scope);
        return;
      case "TSModuleDeclaration":
        if (node.kind === "global") this.addStatements(node.body.body, GLOBAL_INTERFACE_NAME);
        else this.addModule(node.id, node.body, scope);
        return;
      default:
        return;
    }
  }

  private addModule(id: TSModuleDeclaration["id"], body: TSModuleBlock | null, scope: string) {
    if (!body) return;
    if (id.type === "Literal") {
      for (const statement of body.body) {
        if (statement.type === "TSModuleDeclaration" && statement.kind === "global") {
          this.addStatements(statement.body.body, GLOBAL_INTERFACE_NAME);
        }
      }
      return;
    }
    const name = id.type === "Identifier" ? id.name : getQualifiedName(id);
    if (name === null) return;
    const qualified = this.qualify(scope, name);
    const namespaceInterface = `${NAMESPACE_PREFIX}${qualified}`;
    this.getOrCreateInterface(namespaceInterface);
    if (!this.getOrCreateInterface(this.scopeInterface(scope)).members.has(name)) {
      this.addMember(this.scopeInterface(scope), name, {
        form: "namespace",
        interfaceName: namespaceInterface,
      });
    }
    this.addStatements(body.body, qualified);
  }

  private qualify(scope: string, name: string): string {
    return scope === GLOBAL_INTERFACE_NAME ? name : `${scope}.${name}`;
  }

  private scopeInterface(scope: string): string {
    return scope === GLOBAL_INTERFACE_NAME ? scope : `${NAMESPACE_PREFIX}${scope}`;
  }

  private addInterface(node: TSInterfaceDeclaration, scope: string): void {
    const record = this.getOrCreateInterface(this.qualify(scope, node.id.name));
    for (const heritage of node.extends) {
      const name = getExpressionName(heritage.expression);
      if (name !== null) record.extendsNames.push(this.resolveNamespacedName(name, scope));
    }
    for (const signature of node.body.body) {
      if (
        signature.type === "TSCallSignatureDeclaration" ||
        signature.type === "TSConstructSignatureDeclaration"
      ) {
        record.isCallable = true;
        continue;
      }
      const name = getSignatureName(signature);
      if (name === null) continue;
      const declaration = this.signatureDeclaration(signature);
      if (!declaration) continue;
      const existing = record.members.get(name);
      if (existing) existing.push(declaration);
      else record.members.set(name, [declaration]);
    }
  }

  private signatureDeclaration(signature: TSSignature): MemberDeclaration | null {
    if (signature.type === "TSPropertySignature") {
      return { form: "property", type: signature.typeAnnotation?.typeAnnotation ?? null };
    }
    if (signature.type !== "TSMethodSignature") return null;
    switch (signature.kind) {
      case "method":
        return { form: "method", returnType: signature.returnType?.typeAnnotation ?? null };
      case "get":
        return { form: "property", type: signature.returnType?.typeAnnotation ?? null };
      case "set":
        return null;
    }
  }

  private resolveNamespacedName(name: string, scope: string): string {
    for (let namespace = scope; namespace !== GLOBAL_INTERFACE_NAME;) {
      const qualified = `${namespace}.${name}`;
      if (this.interfaces.has(qualified) || this.aliases.has(qualified)) return qualified;
      const separator = namespace.lastIndexOf(".");
      namespace = separator === -1 ? GLOBAL_INTERFACE_NAME : namespace.slice(0, separator);
    }
    return name;
  }

  private addVariables(node: VariableDeclaration, scope: string): void {
    for (const declarator of node.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      const type = declarator.id.typeAnnotation?.typeAnnotation ?? null;
      if (scope === GLOBAL_INTERFACE_NAME && type?.type === "TSIntersectionType") {
        this.recordGlobalObjectInterfaces(type.types);
      }
      this.addMember(this.scopeInterface(scope), declarator.id.name, { form: "property", type });
    }
  }

  private recordGlobalObjectInterfaces(parts: TSType[]): void {
    if (!parts.some(isGlobalThisQuery)) return;
    for (const part of parts) {
      if (part.type !== "TSTypeReference") continue;
      const name = getQualifiedName(part.typeName);
      if (name !== null) this.globalObjectInterfaces.add(name);
    }
  }

  private addFunction(node: Function, scope: string): void {
    if (!node.id) return;
    this.addMember(this.scopeInterface(scope), node.id.name, {
      form: "method",
      returnType: node.returnType?.typeAnnotation ?? null,
    });
  }

  private addClass(node: Class, scope: string): void {
    if (!node.id) return;
    const qualified = this.qualify(scope, node.id.name);
    this.getOrCreateInterface(qualified);
    this.addMember(this.scopeInterface(scope), node.id.name, {
      form: "class",
      interfaceName: qualified,
    });
  }

  private findDeclarations(
    interfaceName: string,
    memberName: string,
    seen: Set<string>,
  ): MemberDeclaration[] | null {
    if (seen.has(interfaceName)) return null;
    seen.add(interfaceName);
    const record = this.interfaces.get(interfaceName);
    if (!record) {
      const alias = this.aliases.get(interfaceName);
      if (!alias) return null;
      const resolved = this.resolveType(alias, GLOBAL_INTERFACE_NAME, new Set([interfaceName]));
      return resolved.interfaceName === null
        ? null
        : this.findDeclarations(resolved.interfaceName, memberName, seen);
    }
    const own = record.members.get(memberName);
    if (own) return own;
    for (const parent of record.extendsNames) {
      const inherited = this.findDeclarations(parent, memberName, seen);
      if (inherited) return inherited;
    }
    return null;
  }

  private resolveDeclarations(
    interfaceName: string,
    declarations: MemberDeclaration[],
  ): HostMember {
    const scope = interfaceName.startsWith(NAMESPACE_PREFIX)
      ? interfaceName.slice(NAMESPACE_PREFIX.length)
      : interfaceName;
    const resolveOrAny = (type: TSType | null): HostType =>
      type ? this.resolveType(type, scope, new Set()) : ANY_TYPE;
    if (declarations.every((declaration) => declaration.form === "method")) {
      const returnTypes = declarations.map((declaration) =>
        declaration.form === "method" ? resolveOrAny(declaration.returnType) : ANY_TYPE,
      );
      const [first] = returnTypes;
      const isConsistent = returnTypes.every((type) => sameType(type, first));
      return { type: FUNCTION_TYPE, returnType: isConsistent ? first : ANY_TYPE };
    }
    const types = declarations.map((declaration): HostType => {
      switch (declaration.form) {
        case "property":
          return resolveOrAny(declaration.type);
        case "method":
          return FUNCTION_TYPE;
        case "class":
          return { kind: "function", interfaceName: declaration.interfaceName, isNullable: false };
        case "namespace":
          return { kind: "object", interfaceName: declaration.interfaceName, isNullable: false };
      }
    });
    const [first] = types;
    if (types.every((type) => sameType(type, first))) return { type: first, returnType: null };
    const kind = types.every((type) => type.kind === first.kind) ? first.kind : "any";
    return { type: { kind, interfaceName: null, isNullable: false }, returnType: null };
  }

  /** `scope` names the enclosing interface or namespace: what `this` and unqualified names resolve against. */
  private resolveType(type: TSType, scope: string, seen: Set<string>): HostType {
    switch (type.type) {
      case "TSStringKeyword":
        return keywordType("string");
      case "TSNumberKeyword":
        return keywordType("number");
      case "TSBooleanKeyword":
      case "TSTypePredicate":
        return keywordType("boolean");
      case "TSBigIntKeyword":
        return keywordType("bigint");
      case "TSSymbolKeyword":
        return keywordType("symbol");
      case "TSUndefinedKeyword":
      case "TSVoidKeyword":
        return keywordType("undefined");
      case "TSNullKeyword":
        return keywordType("null");
      case "TSObjectKeyword":
        return keywordType("object");
      case "TSLiteralType":
        return keywordType(getLiteralKind(type.literal));
      case "TSTemplateLiteralType":
        return keywordType("string");
      case "TSArrayType":
      case "TSTupleType":
        return { kind: "object", interfaceName: "Array", isNullable: false };
      case "TSFunctionType":
      case "TSConstructorType":
        return FUNCTION_TYPE;
      case "TSTypeLiteral": {
        const isCallable = type.members.some(
          (member) =>
            member.type === "TSCallSignatureDeclaration" ||
            member.type === "TSConstructSignatureDeclaration",
        );
        return isCallable ? FUNCTION_TYPE : keywordType("object");
      }
      case "TSThisType":
        return {
          kind: "object",
          interfaceName: scope === GLOBAL_INTERFACE_NAME ? null : scope,
          isNullable: false,
        };
      case "TSParenthesizedType":
        return this.resolveType(type.typeAnnotation, scope, seen);
      case "TSTypeOperator":
        if (type.operator === "unique") return keywordType("symbol");
        return type.operator === "readonly"
          ? this.resolveType(type.typeAnnotation, scope, seen)
          : ANY_TYPE;
      case "TSTypeQuery":
        return this.resolveTypeQuery(type.exprName);
      case "TSTypeReference":
        return this.resolveReference(type.typeName, scope, seen);
      case "TSUnionType":
        return this.resolveUnion(type.types, scope, seen);
      case "TSIntersectionType": {
        const parts = type.types.map((part) => this.resolveType(part, scope, seen));
        return (
          parts.find((part) => this.isGlobalObjectType(part)) ??
          parts.find((part) => part.kind !== "any") ??
          ANY_TYPE
        );
      }
      default:
        return ANY_TYPE;
    }
  }

  private resolveTypeQuery(exprName: TSTypeQueryExprName): HostType {
    if (exprName.type === "TSImportType") return ANY_TYPE;
    const name = getQualifiedName(exprName);
    return name === null ? ANY_TYPE : (this.getGlobal(name)?.type ?? ANY_TYPE);
  }

  private resolveReference(typeName: TSTypeName, scope: string, seen: Set<string>): HostType {
    const name = getQualifiedName(typeName);
    if (name === null) return ANY_TYPE;
    const qualified = this.resolveNamespacedName(name, scope);
    if (this.interfaces.has(qualified)) {
      return {
        kind: this.isCallableInterface(qualified, new Set()) ? "function" : "object",
        interfaceName: qualified,
        isNullable: false,
      };
    }
    const alias = this.aliases.get(qualified);
    if (alias && !seen.has(qualified)) {
      seen.add(qualified);
      return this.resolveType(alias, scope, seen);
    }
    return ANY_TYPE;
  }

  private isCallableInterface(name: string, seen: Set<string>): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const record = this.interfaces.get(name);
    if (!record) return false;
    return (
      record.isCallable ||
      record.extendsNames.some((parent) => this.isCallableInterface(parent, seen))
    );
  }

  private resolveUnion(types: TSType[], scope: string, seen: Set<string>): HostType {
    let isNullable = false;
    const present: HostType[] = [];
    for (const part of types) {
      const resolved = this.resolveType(part, scope, seen);
      if (resolved.kind === "null" || resolved.kind === "undefined") isNullable = true;
      else present.push(resolved);
    }
    const [first] = present;
    if (!first) return { kind: "undefined", interfaceName: null, isNullable };
    return {
      kind: present.every((part) => part.kind === first.kind) ? first.kind : "any",
      interfaceName: present.every((part) => part.interfaceName === first.interfaceName)
        ? first.interfaceName
        : null,
      isNullable,
    };
  }
}
