import type {
  AccessorProperty,
  Class,
  Declaration,
  Directive,
  ExportDefaultDeclarationKind,
  Expression,
  Function,
  ImportDeclarationSpecifier,
  MethodDefinition,
  ModuleExportName,
  PropertyDefinition,
  PropertyKey,
  Statement,
  TSEnumDeclaration,
  TSInterfaceDeclaration,
  TSModuleBlock,
  TSModuleDeclaration,
  TSModuleReference,
  TSSignature,
  TSType,
  TSTypeName,
  TSTypeParameterDeclaration,
  VariableDeclaration,
} from "oxc-parser";
import type { DeclarationFile } from "./declaration-files.js";
import { GLOBAL_INTERFACE_NAME, type HostType } from "./realm-table.js";

export interface ModuleReference {
  specifier: string;
  fromFile: string;
}

/** What an imported or re-exported name stands for. */
export type NameBinding =
  | { form: "named"; module: ModuleReference; importedName: string }
  | { form: "namespace"; module: ModuleReference }
  | { form: "local"; name: string[] };

/**
 * A lexical container of declarations: the global scope, a namespace, an
 * ambient `declare module "x"` or a module file. Types declared inside are
 * keyed `typePrefix + name`; values are members of the `valueHolder` interface.
 */
export interface ContainerRecord {
  typePrefix: string;
  valueHolder: string;
  scope: Scope;
  isModule: boolean;
  imports: Map<string, NameBinding>;
  exportAliases: Map<string, NameBinding>;
  starExports: ModuleReference[];
  exportEquals: string[] | null;
}

export interface Scope {
  /** Innermost first; names resolve against each frame's declarations and imports in turn. */
  frames: ContainerRecord[];
  file: string;
  typeParameters: ReadonlySet<string>;
  thisType: string | null;
}

export type MemberDeclaration =
  | { form: "property"; type: TSType | null; scope: Scope }
  | { form: "method"; returnType: TSType | null; scope: Scope }
  | { form: "reference"; type: HostType };

interface HeritageReference {
  name: string[];
  scope: Scope;
  /** `class B extends A` also inherits `A`'s static side. */
  isStatic: boolean;
}

interface InterfaceRecord {
  heritage: HeritageReference[];
  members: Map<string, MemberDeclaration[]>;
  isCallable: boolean;
}

interface AliasRecord {
  type: TSType;
  typeParameters: string[];
  scope: Scope;
}

const NAMESPACE_PREFIX = "namespace ";
const MODULE_PREFIX = "module ";
export const STATIC_PREFIX = "typeof ";

const EMPTY_TYPE_PARAMETERS: ReadonlySet<string> = new Set();

export const getQualifiedName = (typeName: TSTypeName): string[] | null => {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return null;
  const left = getQualifiedName(typeName.left);
  return left === null ? null : [...left, typeName.right.name];
};

const getExpressionName = (expression: Expression): string[] | null => {
  if (expression.type === "Identifier") return [expression.name];
  if (expression.type !== "MemberExpression" || expression.computed) return null;
  const objectName = getExpressionName(expression.object);
  return objectName === null ? null : [...objectName, expression.property.name];
};

const getModuleExportName = (name: ModuleExportName): string =>
  name.type === "Literal" ? name.value : name.name;

const getPropertyKeyName = (key: PropertyKey, isComputed: boolean): string | null => {
  if (isComputed) return null;
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
};

const getSignatureName = (signature: TSSignature): string | null =>
  signature.type === "TSPropertySignature" || signature.type === "TSMethodSignature"
    ? getPropertyKeyName(signature.key, signature.computed)
    : null;

const isCallSignature = (signature: TSSignature): boolean =>
  signature.type === "TSCallSignatureDeclaration" ||
  signature.type === "TSConstructSignatureDeclaration";

const isGlobalThisQuery = (type: TSType): boolean =>
  type.type === "TSTypeQuery" &&
  type.exprName.type === "Identifier" &&
  type.exprName.name === GLOBAL_INTERFACE_NAME;

const isModuleStatement = (statement: Statement | Directive): boolean => {
  switch (statement.type) {
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
    case "ExportDefaultDeclaration":
    case "TSExportAssignment":
    case "TSImportEqualsDeclaration":
      return true;
    default:
      return false;
  }
};

const unwrapType = (type: TSType): TSType =>
  type.type === "TSParenthesizedType" ? unwrapType(type.typeAnnotation) : type;

const withTypeParameters = (
  scope: Scope,
  declaration: TSTypeParameterDeclaration | null | undefined,
  thisType: string | null = scope.thisType,
): Scope => {
  if (!declaration?.params.length)
    return thisType === scope.thisType ? scope : { ...scope, thisType };
  const typeParameters = new Set(scope.typeParameters);
  for (const parameter of declaration.params) typeParameters.add(parameter.name.name);
  return { ...scope, typeParameters, thisType };
};

/**
 * Indexes `.d.ts` declarations the way the checker binds them: interfaces and
 * namespaces merge, `declare global` contributes to `globalThis`, module files
 * and ambient modules keep their own scopes with imports and re-exports, and
 * classes split into an instance interface and a `typeof` static side. Nothing
 * is resolved here; `HostDeclarationIndex` reads the records lazily.
 */
export class DeclarationCatalog {
  readonly interfaces = new Map<string, InterfaceRecord>();
  readonly aliases = new Map<string, AliasRecord>();
  readonly namespaces = new Map<string, ContainerRecord>();
  readonly ambientModules = new Map<string, ContainerRecord>();
  readonly fileModules = new Map<string, ContainerRecord>();
  /** `declare var window: Window & typeof globalThis`: the global object implements `Window`. */
  readonly globalObjectHeritage: HeritageReference[] = [];
  readonly pendingModules: ModuleReference[] = [];
  readonly global: ContainerRecord;

  constructor() {
    this.global = this.createContainer("", GLOBAL_INTERFACE_NAME, [], "", false);
  }

  addFile(file: DeclarationFile): void {
    const statements = file.program.body;
    if (!statements.some(isModuleStatement)) {
      this.addStatements(statements, this.createScope([this.global], file.filePath));
      return;
    }
    const container = this.createContainer(
      `${JSON.stringify(file.moduleId)}.`,
      `${MODULE_PREFIX}${JSON.stringify(file.moduleId)}`,
      [this.global],
      file.filePath,
      true,
    );
    this.fileModules.set(file.filePath, container);
    this.addStatements(statements, container.scope);
  }

  private createContainer(
    typePrefix: string,
    valueHolder: string,
    enclosingFrames: ContainerRecord[],
    file: string,
    isModule: boolean,
  ): ContainerRecord {
    const container: ContainerRecord = {
      typePrefix,
      valueHolder,
      scope: { frames: [], file, typeParameters: EMPTY_TYPE_PARAMETERS, thisType: null },
      isModule,
      imports: new Map(),
      exportAliases: new Map(),
      starExports: [],
      exportEquals: null,
    };
    container.scope.frames = [container, ...enclosingFrames];
    this.getOrCreateInterface(valueHolder);
    return container;
  }

  private createScope(frames: ContainerRecord[], file: string): Scope {
    return { frames, file, typeParameters: EMPTY_TYPE_PARAMETERS, thisType: null };
  }

  declareInterface(name: string): void {
    this.getOrCreateInterface(name);
  }

  private getOrCreateInterface(name: string): InterfaceRecord {
    let record = this.interfaces.get(name);
    if (!record) {
      record = { heritage: [], members: new Map(), isCallable: false };
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

  private trackModule(specifier: string, scope: Scope): ModuleReference {
    const reference = { specifier, fromFile: scope.file };
    this.pendingModules.push(reference);
    return reference;
  }

  private addStatements(statements: (Statement | Directive)[], scope: Scope): void {
    const [container] = scope.frames;
    for (const statement of statements) {
      switch (statement.type) {
        case "ImportDeclaration":
          this.addImport(statement.source.value, statement.specifiers, scope);
          break;
        case "TSImportEqualsDeclaration":
          this.addImportEquals(statement.id.name, statement.moduleReference, scope);
          break;
        case "ExportNamedDeclaration":
          if (statement.declaration) {
            this.addDeclaration(statement.declaration, scope);
            if (statement.declaration.type === "TSImportEqualsDeclaration") {
              container.exportAliases.set(statement.declaration.id.name, {
                form: "local",
                name: [statement.declaration.id.name],
              });
            }
          }
          for (const specifier of statement.specifiers) {
            const localName = getModuleExportName(specifier.local);
            container.exportAliases.set(
              getModuleExportName(specifier.exported),
              statement.source
                ? {
                    form: "named",
                    module: this.trackModule(statement.source.value, scope),
                    importedName: localName,
                  }
                : { form: "local", name: [localName] },
            );
          }
          break;
        case "ExportAllDeclaration": {
          const module = this.trackModule(statement.source.value, scope);
          if (statement.exported) {
            container.exportAliases.set(getModuleExportName(statement.exported), {
              form: "namespace",
              module,
            });
          } else {
            container.starExports.push(module);
          }
          break;
        }
        case "ExportDefaultDeclaration":
          this.addExportDefault(statement.declaration, scope);
          break;
        case "TSExportAssignment":
          container.exportEquals = getExpressionName(statement.expression);
          break;
        default:
          this.addDeclaration(statement, scope);
      }
    }
  }

  private addImport(
    specifier: string,
    specifiers: ImportDeclarationSpecifier[],
    scope: Scope,
  ): void {
    const module = this.trackModule(specifier, scope);
    const [container] = scope.frames;
    for (const imported of specifiers) {
      switch (imported.type) {
        case "ImportSpecifier":
          container.imports.set(imported.local.name, {
            form: "named",
            module,
            importedName: getModuleExportName(imported.imported),
          });
          break;
        case "ImportDefaultSpecifier":
          container.imports.set(imported.local.name, {
            form: "named",
            module,
            importedName: "default",
          });
          break;
        case "ImportNamespaceSpecifier":
          container.imports.set(imported.local.name, { form: "namespace", module });
          break;
      }
    }
  }

  private addImportEquals(localName: string, reference: TSModuleReference, scope: Scope): void {
    const [container] = scope.frames;
    if (reference.type === "TSExternalModuleReference") {
      container.imports.set(localName, {
        form: "namespace",
        module: this.trackModule(reference.expression.value, scope),
      });
      return;
    }
    const name = getQualifiedName(reference);
    if (name !== null) container.imports.set(localName, { form: "local", name });
  }

  private addExportDefault(declaration: ExportDefaultDeclarationKind, scope: Scope): void {
    const [container] = scope.frames;
    switch (declaration.type) {
      case "ClassDeclaration":
      case "ClassExpression":
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "TSDeclareFunction":
      case "TSInterfaceDeclaration":
        if (!declaration.id) return;
        this.addDeclaration(declaration, scope);
        container.exportAliases.set("default", { form: "local", name: [declaration.id.name] });
        return;
      default: {
        const name = getExpressionName(declaration);
        if (name !== null) container.exportAliases.set("default", { form: "local", name });
      }
    }
  }

  private addDeclaration(
    node: Statement | Directive | Declaration | Class | Function,
    scope: Scope,
  ): void {
    switch (node.type) {
      case "TSInterfaceDeclaration":
        this.addInterface(node, scope);
        return;
      case "TSTypeAliasDeclaration": {
        const aliasName = `${scope.frames[0].typePrefix}${node.id.name}`;
        const typeParameters =
          node.typeParameters?.params.map((parameter) => parameter.name.name) ?? [];
        const unwrapped = unwrapType(node.typeAnnotation);
        if (typeParameters.length === 0 && unwrapped.type === "TSTypeLiteral") {
          const record = this.getOrCreateInterface(aliasName);
          this.addSignatures(record, aliasName, unwrapped.members, {
            ...scope,
            thisType: aliasName,
          });
          return;
        }
        this.aliases.set(aliasName, { type: node.typeAnnotation, typeParameters, scope });
        return;
      }
      case "VariableDeclaration":
        this.addVariables(node, scope);
        return;
      case "FunctionDeclaration":
      case "TSDeclareFunction":
        this.addFunction(node, scope);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        this.addClass(node, scope);
        return;
      case "TSEnumDeclaration":
        this.addEnum(node, scope);
        return;
      case "TSModuleDeclaration":
        if (node.kind === "global") this.addGlobalBlock(node.body, scope);
        else this.addModule(node.id, node.body, scope);
        return;
      default:
        return;
    }
  }

  private addGlobalBlock(body: TSModuleBlock, scope: Scope): void {
    const enclosing = scope.frames.filter((frame) => frame !== this.global);
    this.addStatements(body.body, this.createScope([this.global, ...enclosing], scope.file));
  }

  private addModule(id: TSModuleDeclaration["id"], body: TSModuleBlock | null, scope: Scope) {
    if (id.type === "Literal") {
      let container = this.ambientModules.get(id.value);
      if (!container) {
        container = this.createContainer(
          `${JSON.stringify(id.value)}.`,
          `${MODULE_PREFIX}${JSON.stringify(id.value)}`,
          scope.frames,
          scope.file,
          true,
        );
        this.ambientModules.set(id.value, container);
      }
      if (body)
        this.addStatements(body.body, this.createScope([container, ...scope.frames], scope.file));
      return;
    }
    const segments = id.type === "Identifier" ? [id.name] : getQualifiedName(id);
    if (segments === null) return;
    let current = scope;
    for (const segment of segments) {
      const container = this.enterNamespace(segment, current);
      current = this.createScope([container, ...current.frames], current.file);
    }
    if (body) this.addStatements(body.body, current);
  }

  private enterNamespace(name: string, scope: Scope): ContainerRecord {
    const [parent] = scope.frames;
    const qualified = `${parent.typePrefix}${name}`;
    let container = this.namespaces.get(qualified);
    if (!container) {
      container = this.createContainer(
        `${qualified}.`,
        `${NAMESPACE_PREFIX}${qualified}`,
        scope.frames,
        scope.file,
        false,
      );
      this.namespaces.set(qualified, container);
      this.addMember(parent.valueHolder, name, {
        form: "reference",
        type: { kind: "object", interfaceName: container.valueHolder, isNullable: false },
      });
    }
    return container;
  }

  private addInterface(node: TSInterfaceDeclaration, scope: Scope): void {
    const interfaceName = `${scope.frames[0].typePrefix}${node.id.name}`;
    const record = this.getOrCreateInterface(interfaceName);
    const memberScope = withTypeParameters(scope, node.typeParameters, interfaceName);
    for (const heritage of node.extends) {
      const name = getExpressionName(heritage.expression);
      if (name !== null) record.heritage.push({ name, scope: memberScope, isStatic: false });
    }
    this.addSignatures(record, interfaceName, node.body.body, memberScope);
  }

  private addSignatures(
    record: InterfaceRecord,
    interfaceName: string,
    signatures: TSSignature[],
    scope: Scope,
  ): void {
    for (const signature of signatures) {
      if (isCallSignature(signature)) {
        record.isCallable = true;
        continue;
      }
      const name = getSignatureName(signature);
      if (name === null) continue;
      const declaration = this.signatureDeclaration(
        signature,
        `${interfaceName}["${name}"]`,
        scope,
      );
      if (declaration) this.addMember(interfaceName, name, declaration);
    }
  }

  private signatureDeclaration(
    signature: TSSignature,
    literalName: string,
    scope: Scope,
  ): MemberDeclaration | null {
    if (signature.type === "TSPropertySignature") {
      return this.propertyDeclaration(
        signature.typeAnnotation?.typeAnnotation ?? null,
        literalName,
        scope,
      );
    }
    if (signature.type !== "TSMethodSignature") return null;
    const methodScope = withTypeParameters(scope, signature.typeParameters);
    const returnType = signature.returnType?.typeAnnotation ?? null;
    switch (signature.kind) {
      case "method":
        return { form: "method", returnType, scope: methodScope };
      case "get":
        return { form: "property", type: returnType, scope: methodScope };
      case "set":
        return null;
    }
  }

  /** Object literal types get their own interface so their members stay addressable. */
  private propertyDeclaration(
    type: TSType | null,
    literalName: string,
    scope: Scope,
  ): MemberDeclaration {
    const unwrapped = type === null ? null : unwrapType(type);
    if (unwrapped?.type !== "TSTypeLiteral") return { form: "property", type, scope };
    const record = this.getOrCreateInterface(literalName);
    this.addSignatures(record, literalName, unwrapped.members, { ...scope, thisType: literalName });
    return {
      form: "reference",
      type: {
        kind: record.isCallable ? "function" : "object",
        interfaceName: literalName,
        isNullable: false,
      },
    };
  }

  private addVariables(node: VariableDeclaration, scope: Scope): void {
    const [container] = scope.frames;
    for (const declarator of node.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      const type = declarator.id.typeAnnotation?.typeAnnotation ?? null;
      if (container === this.global && type?.type === "TSIntersectionType") {
        this.recordGlobalObjectHeritage(type.types, scope);
      }
      this.addMember(
        container.valueHolder,
        declarator.id.name,
        this.propertyDeclaration(
          type,
          `${STATIC_PREFIX}${container.typePrefix}${declarator.id.name}`,
          scope,
        ),
      );
    }
  }

  private recordGlobalObjectHeritage(parts: TSType[], scope: Scope): void {
    if (!parts.some(isGlobalThisQuery)) return;
    for (const part of parts) {
      if (part.type !== "TSTypeReference") continue;
      const name = getQualifiedName(part.typeName);
      if (name !== null) this.globalObjectHeritage.push({ name, scope, isStatic: false });
    }
  }

  private addFunction(node: Function, scope: Scope): void {
    if (!node.id) return;
    this.addMember(scope.frames[0].valueHolder, node.id.name, {
      form: "method",
      returnType: node.returnType?.typeAnnotation ?? null,
      scope: withTypeParameters(scope, node.typeParameters),
    });
  }

  private addClass(node: Class, scope: Scope): void {
    if (!node.id) return;
    const [container] = scope.frames;
    const instanceName = `${container.typePrefix}${node.id.name}`;
    const staticName = `${STATIC_PREFIX}${instanceName}`;
    const instance = this.getOrCreateInterface(instanceName);
    const statics = this.getOrCreateInterface(staticName);
    statics.isCallable = true;
    statics.members.set("prototype", [
      {
        form: "reference",
        type: { kind: "object", interfaceName: instanceName, isNullable: false },
      },
    ]);
    const superName = node.superClass ? getExpressionName(node.superClass) : null;
    if (superName !== null) {
      instance.heritage.push({ name: superName, scope, isStatic: false });
      statics.heritage.push({ name: superName, scope, isStatic: true });
    }
    const memberScope = withTypeParameters(scope, node.typeParameters, instanceName);
    for (const element of node.body.body) {
      if (element.type === "StaticBlock" || element.type === "TSIndexSignature") continue;
      this.addClassElement(element, element.static ? staticName : instanceName, memberScope);
    }
    this.addMember(container.valueHolder, node.id.name, {
      form: "reference",
      type: { kind: "function", interfaceName: staticName, isNullable: false },
    });
  }

  private addClassElement(
    element: MethodDefinition | PropertyDefinition | AccessorProperty,
    interfaceName: string,
    scope: Scope,
  ): void {
    const name = getPropertyKeyName(element.key, element.computed);
    if (name === null) return;
    const declaration = this.classElementDeclaration(element, scope);
    if (declaration) this.addMember(interfaceName, name, declaration);
  }

  private classElementDeclaration(
    element: MethodDefinition | PropertyDefinition | AccessorProperty,
    scope: Scope,
  ): MemberDeclaration | null {
    switch (element.type) {
      case "MethodDefinition":
      case "TSAbstractMethodDefinition":
        return this.methodDeclaration(element, scope);
      default:
        return { form: "property", type: element.typeAnnotation?.typeAnnotation ?? null, scope };
    }
  }

  private methodDeclaration(element: MethodDefinition, scope: Scope): MemberDeclaration | null {
    const returnType = element.value.returnType?.typeAnnotation ?? null;
    switch (element.kind) {
      case "method":
        return {
          form: "method",
          returnType,
          scope: withTypeParameters(scope, element.value.typeParameters),
        };
      case "get":
        return { form: "property", type: returnType, scope };
      default:
        return null;
    }
  }

  private addEnum(node: TSEnumDeclaration, scope: Scope): void {
    const [container] = scope.frames;
    const enumName = `${STATIC_PREFIX}${container.typePrefix}${node.id.name}`;
    const record = this.getOrCreateInterface(enumName);
    for (const member of node.body.members) {
      const name =
        member.id.type === "Identifier"
          ? member.id.name
          : member.id.type === "Literal"
            ? member.id.value
            : null;
      if (name === null) continue;
      const isString =
        member.initializer?.type === "Literal" && typeof member.initializer.value === "string";
      record.members.set(name, [
        {
          form: "reference",
          type: { kind: isString ? "string" : "number", interfaceName: null, isNullable: false },
        },
      ]);
    }
    this.addMember(container.valueHolder, node.id.name, {
      form: "reference",
      type: { kind: "object", interfaceName: enumName, isNullable: false },
    });
  }
}
