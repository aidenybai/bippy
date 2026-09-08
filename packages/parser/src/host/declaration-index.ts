import path from "node:path";
import type {
  Node,
  TSConditionalType,
  TSImportType,
  TSImportTypeQualifier,
  TSLiteral,
  TSSignature,
  TSType,
  TSTypeParameterInstantiation,
  TSTypeQueryExprName,
} from "oxc-parser";
import { DeclarationModuleError } from "../errors.js";
import { forEachChildNode } from "../parse/ast-walk.js";
import {
  type ContainerRecord,
  DeclarationCatalog,
  getQualifiedName,
  type MemberDeclaration,
  type ModuleReference,
  type NameBinding,
  type Scope,
  STATIC_PREFIX,
} from "./declaration-catalog.js";
import { DeclarationFileLoader } from "./declaration-files.js";
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

export type ResolutionGapReason =
  | "declared-any"
  | "unresolved-name"
  | "type-parameter"
  | "conditional"
  | "overloads"
  | "merged-declarations"
  | "mixed-union"
  | "unsupported";

/** A member that ships as `any` in the realm table, and why the declarations did not pin it down. */
export interface ResolutionGap {
  site: string;
  reason: ResolutionGapReason;
  detail: string;
}

export interface HostRealmBuild {
  table: HostRealmTable;
  gaps: ResolutionGap[];
}

interface ResolutionContext {
  scope: Scope;
  /** `infer` and alias type-parameter bindings in effect. */
  bindings: ReadonlyMap<string, HostType>;
  aliasChain: ReadonlySet<string>;
  site: string;
}

interface NameReference {
  kind: "name";
  container: ContainerRecord;
  name: string;
  /** Resolve through the module's export surface rather than its lexical scope. */
  isExport: boolean;
}

interface ModuleTarget {
  kind: "module";
  container: ContainerRecord;
}

type NameTarget = NameReference | ModuleTarget;

/** Which declaration space a name is looked up in; a `var` never shadows a same-named interface. */
type SymbolMeaning = "type" | "value";

interface ExtendsVerdict {
  holds: boolean;
  bindings: Map<string, HostType>;
}

const EMPTY_BINDINGS: ReadonlyMap<string, HostType> = new Map();
const EMPTY_CHAIN: ReadonlySet<string> = new Set();

const keywordType = (kind: HostValueKind): HostType => ({
  kind,
  interfaceName: null,
  isNullable: false,
});

const interfaceType = (interfaceName: string, isCallable: boolean): HostType => ({
  kind: isCallable ? "function" : "object",
  interfaceName,
  isNullable: false,
});

const getInferredNames = (type: TSType): string[] => {
  const names: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === "TSInferType") names.push(node.typeParameter.name.name);
    forEachChildNode(node, visit);
  };
  visit(type);
  return names;
};

const sameType = (left: HostType, right: HostType): boolean =>
  left.kind === right.kind &&
  left.interfaceName === right.interfaceName &&
  left.isNullable === right.isNullable;

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

const getImportQualifier = (qualifier: TSImportTypeQualifier): string[] =>
  qualifier.type === "Identifier"
    ? [qualifier.name]
    : [...getImportQualifier(qualifier.left), qualifier.right.name];

const getSignatureName = (signature: TSSignature): string | null => {
  if (signature.type !== "TSPropertySignature" || signature.computed) return null;
  const { key } = signature;
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
};

/**
 * Resolves what the checker would for value declarations in `lib.*.d.ts` and
 * `@types/*`: the `typeof` of every global and member and the interface it
 * implements, following aliases, imports, re-exports, `export =`, class
 * statics, `typeof` queries, indexed access and conditional types such as
 * Node's `typeof globalThis extends { onmessage: any; URL: infer T } ? T : typeof _URL`.
 * Whatever still ends up `any` is reported as a `ResolutionGap`. Runs at build
 * time; `build()` produces the table that ships.
 */
export class HostDeclarationIndex {
  private readonly loader: DeclarationFileLoader;
  private readonly catalog = new DeclarationCatalog();
  private readonly loadedFiles = new Set<string>();
  private readonly memberCache = new Map<string, HostMember | null>();
  private readonly extendsCache = new Map<string, string[]>();
  private readonly activeLookups = new Set<string>();
  private readonly gaps = new Map<string, ResolutionGap>();
  private globalObjectInterfaces: string[] | null = null;
  private probeDepth = 0;

  constructor(libDirectory: string, rootDirectory: string) {
    this.loader = new DeclarationFileLoader(libDirectory, rootDirectory);
  }

  addFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (this.loadedFiles.has(resolved)) return;
    this.loadedFiles.add(resolved);
    const file = this.loader.load(resolved);
    for (const reference of file.references) this.addFile(reference);
    this.catalog.addFile(file);
  }

  addSource(fileName: string, sourceText: string): void {
    this.catalog.addFile(this.loader.fromSource(fileName, sourceText));
  }

  build(): HostRealmBuild {
    this.loadPendingModules();
    const globalObjectInterfaces = this.getGlobalObjectInterfaces();
    const interfaces: Record<string, HostInterface> = {};
    const pending = [GLOBAL_INTERFACE_NAME, ...globalObjectInterfaces];
    const visit = (type: HostType | null) => {
      if (type?.interfaceName && !(type.interfaceName in interfaces)) {
        pending.push(type.interfaceName);
      }
    };
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const record = this.catalog.interfaces.get(name);
      if (!record || name in interfaces) continue;
      const members: Record<string, HostMember> = {};
      interfaces[name] = { extendsNames: this.getExtendsNames(name), members };
      for (const parent of interfaces[name].extendsNames) pending.push(parent);
      for (const [memberName, declarations] of record.members) {
        const member = this.resolveDeclarations(name, memberName, declarations);
        members[memberName] = member;
        visit(member.type);
        visit(member.returnType);
      }
    }
    return {
      table: { globalObjectInterfaces, interfaces },
      gaps: [...this.gaps.values()].sort((left, right) => left.site.localeCompare(right.site)),
    };
  }

  private loadPendingModules(): void {
    const { pendingModules } = this.catalog;
    for (let reference = pendingModules.pop(); reference; reference = pendingModules.pop()) {
      this.getModule(reference);
    }
  }

  private getModule(reference: ModuleReference): ContainerRecord {
    const ambient = this.catalog.ambientModules.get(reference.specifier);
    if (ambient) return ambient;
    const filePath = this.loader.resolveSpecifier(reference.specifier, reference.fromFile);
    this.addFile(filePath);
    const module = this.catalog.fileModules.get(filePath);
    if (!module) {
      throw new DeclarationModuleError(reference.specifier, reference.fromFile, "not a module");
    }
    return module;
  }

  private report(
    context: ResolutionContext,
    reason: ResolutionGapReason,
    detail: string,
  ): HostType {
    if (this.probeDepth === 0) {
      const key = `${context.site}\0${reason}\0${detail}`;
      if (!this.gaps.has(key)) this.gaps.set(key, { site: context.site, reason, detail });
    }
    return ANY_TYPE;
  }

  /** Resolve without recording gaps: used while deciding a conditional type's check. */
  private probe<Result>(compute: () => Result): Result {
    this.probeDepth += 1;
    try {
      return compute();
    } finally {
      this.probeDepth -= 1;
    }
  }

  private getGlobalObjectInterfaces(): string[] {
    if (this.globalObjectInterfaces) return this.globalObjectInterfaces;
    const names = new Set<string>();
    for (const heritage of this.catalog.globalObjectHeritage) {
      const interfaceName = this.lookupInterface(heritage.name, heritage.scope);
      if (interfaceName !== null) names.add(interfaceName);
    }
    this.globalObjectInterfaces = [...names];
    return this.globalObjectInterfaces;
  }

  private isGlobalObjectType(type: HostType): boolean {
    return (
      type.interfaceName !== null &&
      (type.interfaceName === GLOBAL_INTERFACE_NAME ||
        this.getGlobalObjectInterfaces().includes(type.interfaceName))
    );
  }

  private getGlobalObjectMember(memberName: string): HostMember | null {
    if (memberName === GLOBAL_INTERFACE_NAME) return { type: GLOBAL_OBJECT_TYPE, returnType: null };
    for (const interfaceName of this.getGlobalObjectInterfaces()) {
      const member = this.getMember(interfaceName, memberName);
      if (member) return member;
    }
    return this.getMember(GLOBAL_INTERFACE_NAME, memberName);
  }

  private getMember(interfaceName: string, memberName: string): HostMember | null {
    const cacheKey = `${interfaceName}\0${memberName}`;
    const cached = this.memberCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (this.activeLookups.has(cacheKey)) return null;
    this.activeLookups.add(cacheKey);
    const declarations = this.findDeclarations(interfaceName, memberName, new Set());
    const member = declarations
      ? this.resolveDeclarations(interfaceName, memberName, declarations)
      : null;
    this.activeLookups.delete(cacheKey);
    if (this.probeDepth === 0) this.memberCache.set(cacheKey, member);
    return member;
  }

  private memberOf(value: HostType, memberName: string): HostMember | null {
    if (this.isGlobalObjectType(value)) return this.getGlobalObjectMember(memberName);
    return value.interfaceName === null ? null : this.getMember(value.interfaceName, memberName);
  }

  private findDeclarations(
    interfaceName: string,
    memberName: string,
    seen: Set<string>,
  ): MemberDeclaration[] | null {
    if (seen.has(interfaceName)) return null;
    seen.add(interfaceName);
    const record = this.catalog.interfaces.get(interfaceName);
    if (!record) {
      const resolved = this.aliasInterface(interfaceName);
      return resolved === null ? null : this.findDeclarations(resolved, memberName, seen);
    }
    const own = record.members.get(memberName);
    if (own) return own;
    for (const parent of this.getExtendsNames(interfaceName)) {
      const inherited = this.findDeclarations(parent, memberName, seen);
      if (inherited) return inherited;
    }
    return null;
  }

  /** The interface an alias key stands for, when it names one. */
  private aliasInterface(aliasName: string): string | null {
    const alias = this.catalog.aliases.get(aliasName);
    if (!alias) return null;
    const resolved = this.probe(() =>
      this.resolveType(alias.type, {
        scope: alias.scope,
        bindings: EMPTY_BINDINGS,
        aliasChain: new Set([aliasName]),
        site: aliasName,
      }),
    );
    return resolved.interfaceName;
  }

  private getExtendsNames(interfaceName: string): string[] {
    const cached = this.extendsCache.get(interfaceName);
    if (cached) return cached;
    const record = this.catalog.interfaces.get(interfaceName);
    const names: string[] = [];
    for (const heritage of record?.heritage ?? []) {
      const resolved = this.lookupInterface(heritage.name, heritage.scope);
      if (resolved === null) {
        this.report(
          {
            scope: heritage.scope,
            bindings: EMPTY_BINDINGS,
            aliasChain: EMPTY_CHAIN,
            site: interfaceName,
          },
          "unresolved-name",
          `extends ${heritage.name.join(".")}`,
        );
        continue;
      }
      const parent = heritage.isStatic ? `${STATIC_PREFIX}${resolved}` : resolved;
      if (this.catalog.interfaces.has(parent) && !names.includes(parent)) names.push(parent);
    }
    this.extendsCache.set(interfaceName, names);
    return names;
  }

  private isSubtype(interfaceName: string, ancestorName: string): boolean {
    const pending = [interfaceName];
    const seen = new Set<string>();
    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      if (seen.has(current)) continue;
      seen.add(current);
      if (current === ancestorName) return true;
      pending.push(...this.getExtendsNames(current));
    }
    return false;
  }

  private isCallableInterface(interfaceName: string, seen = new Set<string>()): boolean {
    if (seen.has(interfaceName)) return false;
    seen.add(interfaceName);
    const record = this.catalog.interfaces.get(interfaceName);
    if (!record) return false;
    return (
      record.isCallable ||
      this.getExtendsNames(interfaceName).some((parent) => this.isCallableInterface(parent, seen))
    );
  }

  private lookupInterface(name: string[], scope: Scope): string | null {
    const typeName = this.lookupType(name, scope);
    if (typeName === null) return null;
    return this.catalog.interfaces.has(typeName) ? typeName : this.aliasInterface(typeName);
  }

  private hasOwnName(container: ContainerRecord, name: string, meaning: SymbolMeaning): boolean {
    const qualified = `${container.typePrefix}${name}`;
    if (this.catalog.namespaces.has(qualified)) return true;
    return meaning === "type"
      ? (qualified !== container.valueHolder && this.catalog.interfaces.has(qualified)) ||
          this.catalog.aliases.has(qualified)
      : this.ownDeclarations(container, name) !== null;
  }

  private ownDeclarations(container: ContainerRecord, name: string): MemberDeclaration[] | null {
    if (container === this.catalog.global) {
      for (const interfaceName of this.getGlobalObjectInterfaces()) {
        const declarations = this.findDeclarations(interfaceName, name, new Set());
        if (declarations) return declarations;
      }
    }
    return this.catalog.interfaces.get(container.valueHolder)?.members.get(name) ?? null;
  }

  private findLexical(name: string, scope: Scope, meaning: SymbolMeaning): NameTarget | null {
    for (const frame of scope.frames) {
      const binding = frame.imports.get(name);
      if (binding) return this.resolveBinding(binding, frame, meaning);
      if (this.hasOwnName(frame, name, meaning)) {
        return { kind: "name", container: frame, name, isExport: false };
      }
    }
    return name === GLOBAL_INTERFACE_NAME
      ? { kind: "module", container: this.catalog.global }
      : null;
  }

  private resolveBinding(
    binding: NameBinding,
    container: ContainerRecord,
    meaning: SymbolMeaning,
  ): NameTarget | null {
    switch (binding.form) {
      case "named":
        return {
          kind: "name",
          container: this.getModule(binding.module),
          name: binding.importedName,
          isExport: true,
        };
      case "namespace":
        return { kind: "module", container: this.getModule(binding.module) };
      case "local":
        return this.lookupPath(binding.name, container.scope, meaning);
    }
  }

  private lookupPath(segments: string[], scope: Scope, meaning: SymbolMeaning): NameTarget | null {
    let target = this.findLexical(segments[0], scope, segments.length === 1 ? meaning : "value");
    for (const segment of segments.slice(1)) {
      const container = target === null ? null : this.targetContainer(target);
      if (container === null) return null;
      target = { kind: "name", container, name: segment, isExport: container.isModule };
    }
    return target;
  }

  private lookupExport<Result>(
    module: ContainerRecord,
    name: string,
    meaning: SymbolMeaning,
    project: (target: NameTarget) => Result | null,
    seen = new Set<ContainerRecord>(),
  ): Result | null {
    if (seen.has(module)) return null;
    seen.add(module);
    const own = project({ kind: "name", container: module, name, isExport: false });
    if (own !== null) return own;
    const alias = module.exportAliases.get(name);
    if (alias) {
      const target = this.resolveBinding(alias, module, meaning);
      const projected = target === null ? null : project(target);
      if (projected !== null) return projected;
    }
    if (name !== "default") {
      for (const star of module.starExports) {
        const projected = this.lookupExport(this.getModule(star), name, meaning, project, seen);
        if (projected !== null) return projected;
      }
    }
    if (module.exportEquals) {
      const target = this.lookupPath(module.exportEquals, module.scope, "value");
      const container = target === null ? null : this.targetContainer(target);
      if (container)
        return project({ kind: "name", container, name, isExport: container.isModule });
    }
    return null;
  }

  private throughExports<Result>(
    reference: NameReference,
    kind: string,
    meaning: SymbolMeaning,
    project: (target: NameTarget) => Result | null,
  ): Result | null {
    const key = `${reference.container.valueHolder}\0${reference.name}\0${kind}`;
    if (this.activeLookups.has(key)) return null;
    this.activeLookups.add(key);
    const result = this.lookupExport(reference.container, reference.name, meaning, project);
    this.activeLookups.delete(key);
    return result;
  }

  private targetContainer(target: NameTarget): ContainerRecord | null {
    if (target.kind === "module") return target.container;
    if (target.isExport) {
      return this.throughExports(target, "container", "value", (inner) =>
        this.targetContainer(inner),
      );
    }
    const namespace = this.catalog.namespaces.get(`${target.container.typePrefix}${target.name}`);
    if (namespace) return namespace;
    const binding = target.container.imports.get(target.name);
    const bound = binding ? this.resolveBinding(binding, target.container, "value") : null;
    return bound === null ? null : this.targetContainer(bound);
  }

  private targetType(target: NameTarget): string | null {
    if (target.kind === "module") return null;
    if (target.isExport) {
      return this.throughExports(target, "type", "type", (inner) => this.targetType(inner));
    }
    const qualified = `${target.container.typePrefix}${target.name}`;
    if (this.catalog.interfaces.has(qualified) || this.catalog.aliases.has(qualified))
      return qualified;
    const binding = target.container.imports.get(target.name);
    const bound = binding ? this.resolveBinding(binding, target.container, "type") : null;
    return bound === null ? null : this.targetType(bound);
  }

  private targetValue(target: NameTarget): HostMember | null {
    if (target.kind === "module") return this.moduleValue(target.container);
    if (target.isExport) {
      return this.throughExports(target, "value", "value", (inner) => this.targetValue(inner));
    }
    const declarations = this.ownDeclarations(target.container, target.name);
    if (declarations) {
      return this.resolveDeclarations(target.container.valueHolder, target.name, declarations);
    }
    const binding = target.container.imports.get(target.name);
    const bound = binding ? this.resolveBinding(binding, target.container, "value") : null;
    return bound === null ? null : this.targetValue(bound);
  }

  private moduleValue(module: ContainerRecord): HostMember | null {
    if (module.exportEquals) {
      const target = this.lookupPath(module.exportEquals, module.scope, "value");
      return target === null ? null : this.targetValue(target);
    }
    return { type: interfaceType(module.valueHolder, false), returnType: null };
  }

  /** A type key (interface or alias) for a qualified type name. */
  private lookupType(segments: string[], scope: Scope): string | null {
    const target = this.lookupPath(segments, scope, "type");
    return target === null ? null : this.targetType(target);
  }

  /** `typeof a.b.c`: namespaces and modules first, then member access on the value reached. */
  private lookupValue(segments: string[], scope: Scope): HostMember | null {
    let target = this.findLexical(segments[0], scope, "value");
    if (target === null) return null;
    let value: HostMember | null = null;
    for (const segment of segments.slice(1)) {
      if (value === null) {
        const container = this.targetContainer(target);
        if (container) {
          target = { kind: "name", container, name: segment, isExport: container.isModule };
          continue;
        }
        value = this.targetValue(target);
        if (value === null) return null;
      }
      value = this.memberOf(value.type, segment);
      if (value === null) return null;
    }
    return value ?? this.targetValue(target);
  }

  private resolveDeclarations(
    holder: string,
    memberName: string,
    declarations: MemberDeclaration[],
  ): HostMember {
    const site = `${holder}.${memberName}`;
    const contextFor = (scope: Scope): ResolutionContext => ({
      scope,
      bindings: EMPTY_BINDINGS,
      aliasChain: EMPTY_CHAIN,
      site,
    });
    const types: HostType[] = [];
    const returnTypes: HostType[] = [];
    for (const declaration of declarations) {
      switch (declaration.form) {
        case "property": {
          const context = contextFor(declaration.scope);
          types.push(
            declaration.type
              ? this.resolveType(declaration.type, context)
              : this.report(context, "declared-any", "untyped declaration"),
          );
          break;
        }
        case "method": {
          const context = contextFor(declaration.scope);
          types.push(FUNCTION_TYPE);
          returnTypes.push(
            declaration.returnType
              ? this.resolveType(declaration.returnType, context)
              : this.report(context, "declared-any", "untyped return"),
          );
          break;
        }
        case "reference":
          types.push(declaration.type);
          break;
      }
    }
    const reportingContext = contextFor(this.catalog.global.scope);
    const type = this.mergeDeclaredTypes(types, reportingContext);
    if (returnTypes.length === 0 || type.kind !== "function") return { type, returnType: null };
    return { type, returnType: this.joinTypes(returnTypes, reportingContext, "overloads") };
  }

  /**
   * Merged declarations (`var console: Console` + `namespace console`,
   * `function assert` + `namespace assert`) resolve to one value carrying every
   * declaration's members; a callable among them makes the merge callable.
   */
  private mergeDeclaredTypes(types: HostType[], context: ResolutionContext): HostType {
    const [first] = types;
    if (types.every((type) => sameType(type, first))) return first;
    const isObjectLike = (type: HostType) => type.kind === "object" || type.kind === "function";
    if (types.every(isObjectLike)) {
      return {
        kind: types.some((type) => type.kind === "function") ? "function" : "object",
        interfaceName: this.intersectInterfaces(types),
        isNullable: false,
      };
    }
    if (types.every((type) => type.kind === first.kind)) {
      return {
        kind: first.kind,
        interfaceName: null,
        isNullable: types.some((type) => type.isNullable),
      };
    }
    return this.report(
      context,
      "merged-declarations",
      types.map((type) => type.interfaceName ?? type.kind).join(" & "),
    );
  }

  /** An interface with the members of every carrier, materialized once as `A & B`. */
  private intersectInterfaces(types: HostType[]): string | null {
    const carriers = [...new Set(types.flatMap((type) => type.interfaceName ?? []))];
    if (carriers.length <= 1) return carriers[0] ?? null;
    const name = carriers.join(" & ");
    if (!this.catalog.interfaces.has(name)) {
      this.catalog.declareInterface(name);
      this.extendsCache.set(name, carriers);
    }
    return name;
  }

  private resolveType(type: TSType, context: ResolutionContext): HostType {
    switch (type.type) {
      case "TSStringKeyword":
      case "TSTemplateLiteralType":
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
      case "TSNeverKeyword":
        return keywordType("undefined");
      case "TSNullKeyword":
        return keywordType("null");
      case "TSObjectKeyword":
      case "TSMappedType":
        return keywordType("object");
      case "TSAnyKeyword":
      case "TSUnknownKeyword":
        return this.report(
          context,
          "declared-any",
          type.type === "TSAnyKeyword" ? "any" : "unknown",
        );
      case "TSLiteralType":
        return keywordType(getLiteralKind(type.literal));
      case "TSArrayType":
      case "TSTupleType":
        return interfaceType("Array", false);
      case "TSFunctionType":
      case "TSConstructorType":
        return FUNCTION_TYPE;
      case "TSTypeLiteral":
        return type.members.some(
          (member) =>
            member.type === "TSCallSignatureDeclaration" ||
            member.type === "TSConstructSignatureDeclaration",
        )
          ? FUNCTION_TYPE
          : keywordType("object");
      case "TSThisType":
        return context.scope.thisType === null
          ? this.report(context, "unsupported", "this outside an interface")
          : interfaceType(context.scope.thisType, this.isCallableInterface(context.scope.thisType));
      case "TSParenthesizedType":
        return this.resolveType(type.typeAnnotation, context);
      case "TSTypeOperator":
        switch (type.operator) {
          case "unique":
            return keywordType("symbol");
          case "readonly":
            return this.resolveType(type.typeAnnotation, context);
          case "keyof": {
            const operand = this.probe(() => this.resolveType(type.typeAnnotation, context));
            return operand.interfaceName === null
              ? this.report(context, "unsupported", `keyof ${operand.kind}`)
              : keywordType("string");
          }
        }
        break;
      case "TSInferType": {
        const bound = context.bindings.get(type.typeParameter.name.name);
        return (
          bound ?? this.report(context, "type-parameter", `infer ${type.typeParameter.name.name}`)
        );
      }
      case "TSTypeQuery":
        return this.resolveTypeQuery(type.exprName, context);
      case "TSImportType": {
        const typeName = this.lookupImportedType(type, context);
        return typeName === null
          ? this.report(context, "unresolved-name", `import(${type.source.value})`)
          : this.resolveNamedType(typeName, type.typeArguments, context);
      }
      case "TSTypeReference":
        return this.resolveReference(type, context);
      case "TSIndexedAccessType":
        return this.resolveIndexedAccess(type.objectType, type.indexType, context);
      case "TSConditionalType":
        return this.resolveConditional(type, context);
      case "TSUnionType":
        return this.resolveUnion(type.types, context);
      case "TSIntersectionType":
        return this.resolveIntersection(type.types, context);
    }
    return this.report(context, "unsupported", type.type);
  }

  private resolveReference(
    type: Extract<TSType, { type: "TSTypeReference" }>,
    context: ResolutionContext,
  ): HostType {
    const name = getQualifiedName(type.typeName);
    if (name === null) return this.report(context, "unsupported", "this-qualified type");
    if (name.length === 1) {
      const bound = context.bindings.get(name[0]);
      if (bound) return bound;
      if (context.scope.typeParameters.has(name[0])) {
        return this.report(context, "type-parameter", name[0]);
      }
    }
    const typeName = this.lookupType(name, context.scope);
    return typeName === null
      ? this.report(context, "unresolved-name", name.join("."))
      : this.resolveNamedType(typeName, type.typeArguments, context);
  }

  private resolveNamedType(
    typeName: string,
    typeArguments: TSTypeParameterInstantiation | null,
    context: ResolutionContext,
  ): HostType {
    if (this.catalog.interfaces.has(typeName)) {
      return interfaceType(typeName, this.isCallableInterface(typeName));
    }
    const alias = this.catalog.aliases.get(typeName);
    if (!alias) return this.report(context, "unresolved-name", typeName);
    if (context.aliasChain.has(typeName)) {
      return this.report(context, "unsupported", `recursive alias ${typeName}`);
    }
    const bindings = new Map<string, HostType>();
    alias.typeParameters.forEach((parameter, index) => {
      const argument = typeArguments?.params[index];
      if (argument) bindings.set(parameter, this.resolveType(argument, context));
    });
    return this.resolveType(alias.type, {
      scope: alias.scope,
      bindings,
      aliasChain: new Set([...context.aliasChain, typeName]),
      site: context.site,
    });
  }

  private resolveTypeQuery(exprName: TSTypeQueryExprName, context: ResolutionContext): HostType {
    if (exprName.type === "TSImportType") {
      const value = this.lookupImportedValue(exprName, context);
      return (
        value?.type ??
        this.report(context, "unresolved-name", `typeof import(${exprName.source.value})`)
      );
    }
    const name = getQualifiedName(exprName);
    if (name === null) return this.report(context, "unsupported", "typeof this");
    const value = this.lookupValue(name, context.scope);
    return value?.type ?? this.report(context, "unresolved-name", `typeof ${name.join(".")}`);
  }

  private importedModule(type: TSImportType, context: ResolutionContext): ContainerRecord {
    return this.getModule({ specifier: type.source.value, fromFile: context.scope.file });
  }

  private lookupImportedType(type: TSImportType, context: ResolutionContext): string | null {
    if (!type.qualifier) return null;
    const [head, ...rest] = getImportQualifier(type.qualifier);
    let target: NameTarget | null = {
      kind: "name",
      container: this.importedModule(type, context),
      name: head,
      isExport: true,
    };
    for (const segment of rest) {
      const container = this.targetContainer(target);
      if (container === null) return null;
      target = { kind: "name", container, name: segment, isExport: container.isModule };
    }
    return this.targetType(target);
  }

  private lookupImportedValue(type: TSImportType, context: ResolutionContext): HostMember | null {
    const module = this.importedModule(type, context);
    if (!type.qualifier) return this.moduleValue(module);
    const [head, ...rest] = getImportQualifier(type.qualifier);
    let value = this.targetValue({ kind: "name", container: module, name: head, isExport: true });
    for (const segment of rest) {
      if (value === null) return null;
      value = this.memberOf(value.type, segment);
    }
    return value;
  }

  private resolveIndexedAccess(
    objectType: TSType,
    indexType: TSType,
    context: ResolutionContext,
  ): HostType {
    const object = this.resolveType(objectType, context);
    if (indexType.type === "TSTypeReference" && indexType.typeName.type === "Identifier") {
      const { name } = indexType.typeName;
      if (context.scope.typeParameters.has(name) || context.bindings.has(name)) {
        return this.report(context, "type-parameter", name);
      }
    }
    if (indexType.type !== "TSLiteralType" || indexType.literal.type !== "Literal") {
      return this.report(context, "unsupported", `indexed access by ${indexType.type}`);
    }
    const key = indexType.literal.value;
    if (typeof key !== "string") {
      return this.report(context, "unsupported", `indexed access by ${typeof key}`);
    }
    const member = this.memberOf(object, key);
    return member?.type ?? this.report(context, "unresolved-name", `[${JSON.stringify(key)}]`);
  }

  private resolveConditional(type: TSConditionalType, context: ResolutionContext): HostType {
    const verdict = this.probe(() =>
      this.evaluateExtends(type.checkType, type.extendsType, context),
    );
    const bindings = new Map([...context.bindings, ...(verdict?.bindings ?? [])]);
    const branchContext = { ...context, bindings };
    if (verdict && !verdict.holds) return this.resolveType(type.falseType, branchContext);
    for (const name of getInferredNames(type.extendsType)) {
      if (!bindings.has(name)) bindings.set(name, this.report(context, "type-parameter", name));
    }
    if (verdict) return this.resolveType(type.trueType, branchContext);
    const whenTrue = this.resolveType(type.trueType, branchContext);
    const whenFalse = this.resolveType(type.falseType, branchContext);
    return sameType(whenTrue, whenFalse)
      ? whenTrue
      : this.report(context, "conditional", `${whenTrue.kind} : ${whenFalse.kind}`);
  }

  private evaluateExtends(
    checkType: TSType,
    extendsType: TSType,
    context: ResolutionContext,
  ): ExtendsVerdict | null {
    const bindings = new Map<string, HostType>();
    if (extendsType.type === "TSAnyKeyword" || extendsType.type === "TSUnknownKeyword") {
      return { holds: true, bindings };
    }
    const check = this.resolveType(checkType, context);
    if (check.kind === "any") return null;
    if (extendsType.type === "TSTypeLiteral") {
      for (const signature of extendsType.members) {
        const name = getSignatureName(signature);
        if (signature.type !== "TSPropertySignature" || name === null) return null;
        const member = this.memberOf(check, name);
        if (member === null) return check.kind === "object" ? { holds: false, bindings } : null;
        const expected = signature.typeAnnotation?.typeAnnotation;
        if (!expected || expected.type === "TSAnyKeyword" || expected.type === "TSUnknownKeyword")
          continue;
        if (expected.type === "TSInferType") {
          bindings.set(expected.typeParameter.name.name, member.type);
          continue;
        }
        const resolvedExpected = this.resolveType(expected, context);
        if (resolvedExpected.kind === "any" || member.type.kind === "any") return null;
        if (resolvedExpected.kind !== member.type.kind) return { holds: false, bindings };
      }
      return { holds: true, bindings };
    }
    const expected = this.resolveType(extendsType, context);
    if (expected.kind === "any") return null;
    if (expected.interfaceName !== null) {
      if (check.interfaceName !== null) {
        return { holds: this.isSubtype(check.interfaceName, expected.interfaceName), bindings };
      }
      return check.kind === "object" || check.kind === "function"
        ? null
        : { holds: false, bindings };
    }
    return { holds: expected.kind === check.kind, bindings };
  }

  private resolveUnion(types: TSType[], context: ResolutionContext): HostType {
    return this.joinTypes(
      types
        .filter((part) => part.type !== "TSNeverKeyword")
        .map((part) => this.resolveType(part, context)),
      context,
      "mixed-union",
    );
  }

  /** The single `typeof` a set of alternatives (union members, overload returns) agrees on. */
  private joinTypes(
    types: HostType[],
    context: ResolutionContext,
    disagreement: ResolutionGapReason,
  ): HostType {
    let isNullable = false;
    const present: HostType[] = [];
    for (const part of types) {
      if (part.kind === "null" || part.kind === "undefined") isNullable = true;
      else present.push(part);
    }
    const [first] = present;
    if (!first) return keywordType("undefined");
    if (present.some((part) => part.kind === "any")) return ANY_TYPE;
    if (!present.every((part) => part.kind === first.kind)) {
      return this.report(context, disagreement, present.map((part) => part.kind).join(" | "));
    }
    return {
      kind: first.kind,
      interfaceName: present.every((part) => part.interfaceName === first.interfaceName)
        ? first.interfaceName
        : null,
      isNullable: isNullable || present.some((part) => part.isNullable),
    };
  }

  private resolveIntersection(types: TSType[], context: ResolutionContext): HostType {
    const parts = types
      .map((part) => this.resolveType(part, context))
      .filter((part) => part.kind !== "any");
    const globalObject = parts.find((part) => this.isGlobalObjectType(part));
    if (globalObject) return globalObject;
    const primitive = parts.find((part) => part.kind !== "object" && part.kind !== "function");
    if (primitive) return primitive;
    if (parts.length === 0) return ANY_TYPE;
    return {
      kind: parts.some((part) => part.kind === "function") ? "function" : "object",
      interfaceName: this.intersectInterfaces(parts),
      isNullable: false,
    };
  }
}
