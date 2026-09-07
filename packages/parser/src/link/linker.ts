import type { Class, Expression, Function as FunctionNode, Statement } from "@oxc-project/types";
import {
  collectIdentifierNames,
  getMemberChain,
  isCallExpression,
  isStringLiteral,
  unwrapExpression,
} from "../module/ast.js";
import {
  type Binding,
  DEFAULT_EXPORT_NAME,
  type DeclarationNode,
  NAMESPACE_IMPORT_NAME,
  type ParsedModule,
} from "../module/types.js";
import type { Project } from "../project/project.js";

export interface DeclarationSymbol {
  kind: "declaration";
  module: ParsedModule;
  localName: string;
  node: DeclarationNode;
}

export interface ValueSymbol {
  kind: "value";
  module: ParsedModule;
  exportedName: string;
  node: Expression | FunctionNode | Class;
}

export interface NamespaceSymbol {
  kind: "namespace";
  module: ParsedModule;
}

export interface ExternalSymbol {
  kind: "external";
  specifier: string;
  packageName: string | null;
  /** `default`, `*` or the exported name imported from the package. */
  importedName: string;
  memberPath: string[];
}

export interface UnresolvedSymbol {
  kind: "unresolved";
  reason: string;
  name: string;
  memberPath: string[];
}

export type LinkedSymbol =
  | DeclarationSymbol
  | ValueSymbol
  | NamespaceSymbol
  | ExternalSymbol
  | UnresolvedSymbol;

/** Packages whose internals are modelled directly rather than parsed. */
const OPAQUE_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-native",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react/compiler-runtime",
  "scheduler",
]);

export const isOpaqueSpecifier = (specifier: string): boolean =>
  OPAQUE_PACKAGES.has(specifier) ||
  specifier.startsWith("react-dom/") ||
  specifier.startsWith("react-native/") ||
  specifier.startsWith("node:");

/** What a module's top level does to a binding after declaring it. */
export interface MemberAssignments {
  /** `X.member = …` and `Object.assign(X, { member: … })`, by member. */
  members: Map<string, Expression>;
  /** The binding also appears in top-level code the analysis never runs, which may write more. */
  hasUntrackedWrites: boolean;
}

export interface Linker {
  resolveReference: (module: ParsedModule, chain: string[]) => LinkedSymbol;
  resolveExport: (module: ParsedModule, exportedName: string) => LinkedSymbol;
  resolveImportedModule: (fromModule: ParsedModule, specifier: string) => ParsedModule | null;
  getMemberAssignments: (module: ParsedModule, localName: string) => MemberAssignments;
}

const unresolved = (name: string, reason: string, memberPath: string[] = []): UnresolvedSymbol => ({
  kind: "unresolved",
  reason,
  name,
  memberPath,
});

const external = (
  specifier: string,
  packageName: string | null,
  importedName: string,
  memberPath: string[],
): ExternalSymbol => ({ kind: "external", specifier, packageName, importedName, memberPath });

/**
 * `Object.assign(Card, { Header, Body })` at module level, the other way
 * compound components are assembled.
 */
const getAssignedObjectMembers = (
  expression: Expression,
): { target: string; members: [string, Expression][]; isComplete: boolean } | null => {
  if (!isCallExpression(expression)) return null;
  const chain = getMemberChain(expression.callee);
  if (chain?.join(".") !== "Object.assign") return null;
  const [target, ...sources] = expression.arguments;
  if (target?.type !== "Identifier") return null;
  const members: [string, Expression][] = [];
  let isComplete = true;
  for (const source of sources) {
    if (source.type !== "ObjectExpression") {
      isComplete = false;
      continue;
    }
    for (const property of source.properties) {
      const key =
        property.type !== "Property" || property.computed
          ? null
          : property.key.type === "Identifier"
            ? property.key.name
            : isStringLiteral(property.key)
              ? property.key.value
              : null;
      if (key === null || property.type !== "Property") isComplete = false;
      else members.push([key, property.value]);
    }
  }
  return { target: target.name, members, isComplete };
};

/** `X.member = value` with a plain identifier and a static member name. */
const getAssignedMember = (
  expression: Expression,
): { target: string; member: string; value: Expression } | null => {
  if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return null;
  if (expression.left.type !== "MemberExpression" || expression.left.computed) return null;
  const object = unwrapExpression(expression.left.object);
  if (object.type !== "Identifier" || expression.left.property.type !== "Identifier") return null;
  return { target: object.name, member: expression.left.property.name, value: expression.right };
};

/** Top-level statements that run when the module loads; declarations are evaluated on demand instead. */
const isRunOnLoad = (statement: Statement): boolean =>
  !statement.type.endsWith("Declaration") &&
  statement.type !== "EmptyStatement" &&
  statement.type !== "DebuggerStatement";

/**
 * Member writes the module's top level makes to its bindings. Only the two
 * assignment forms are followed; every binding a statement of any other
 * shape mentions may have been written in ways the analysis cannot see.
 */
const collectMemberAssignments = (module: ParsedModule): Map<string, MemberAssignments> => {
  const table = new Map<string, MemberAssignments>();
  const entryFor = (target: string): MemberAssignments => {
    let entry = table.get(target);
    if (!entry) {
      entry = { members: new Map(), hasUntrackedWrites: false };
      table.set(target, entry);
    }
    return entry;
  };
  const markUntracked = (node: object): void => {
    const names = new Set<string>();
    collectIdentifierNames(node, names);
    for (const name of names) entryFor(name).hasUntrackedWrites = true;
  };
  for (const statement of module.program.body) {
    if (!isRunOnLoad(statement)) continue;
    if (statement.type !== "ExpressionStatement") {
      markUntracked(statement);
      continue;
    }
    const expression = unwrapExpression(statement.expression);
    const assignedObject = getAssignedObjectMembers(expression);
    if (assignedObject) {
      const entry = entryFor(assignedObject.target);
      for (const [member, value] of assignedObject.members) entry.members.set(member, value);
      if (!assignedObject.isComplete) entry.hasUntrackedWrites = true;
      continue;
    }
    const assigned = getAssignedMember(expression);
    if (assigned) entryFor(assigned.target).members.set(assigned.member, assigned.value);
    else markUntracked(statement);
  }
  return table;
};

const NO_MEMBER_ASSIGNMENTS: MemberAssignments = { members: new Map(), hasUntrackedWrites: false };

export const createLinker = (project: Project): Linker => {
  const memberAssignmentsByModule = new WeakMap<ParsedModule, Map<string, MemberAssignments>>();

  const getMemberAssignments = (module: ParsedModule, localName: string): MemberAssignments => {
    let table = memberAssignmentsByModule.get(module);
    if (!table) {
      table = collectMemberAssignments(module);
      memberAssignmentsByModule.set(module, table);
    }
    return table.get(localName) ?? NO_MEMBER_ASSIGNMENTS;
  };

  const resolveImportedModule = (
    fromModule: ParsedModule,
    specifier: string,
  ): ParsedModule | null => {
    if (isOpaqueSpecifier(specifier)) return null;
    const resolved = project.resolveSpecifier(fromModule.filePath, specifier);
    if (!resolved) return null;
    if (resolved.isExternal && !project.followExternalModules) return null;
    return project.getModule(resolved.path);
  };

  const describeImport = (
    fromModule: ParsedModule,
    specifier: string,
    importedName: string,
    memberPath: string[],
  ): ExternalSymbol => {
    const resolved = isOpaqueSpecifier(specifier)
      ? null
      : project.resolveSpecifier(fromModule.filePath, specifier);
    return external(specifier, resolved?.packageName ?? null, importedName, memberPath);
  };

  const applyMemberPath = (
    symbol: LinkedSymbol,
    memberPath: string[],
    visited: Set<string>,
  ): LinkedSymbol => {
    if (memberPath.length === 0) return symbol;
    const [member, ...rest] = memberPath;
    switch (symbol.kind) {
      case "external":
        return { ...symbol, memberPath: [...symbol.memberPath, ...memberPath] };
      case "unresolved":
        return { ...symbol, memberPath: [...symbol.memberPath, ...memberPath] };
      case "namespace":
        return applyMemberPath(
          resolveExportInternal(symbol.module, member, visited),
          rest,
          visited,
        );
      case "value":
        return applyMemberPath(
          resolveExpressionMember(symbol.module, symbol.node, member, visited),
          rest,
          visited,
        );
      case "declaration": {
        const assigned = getMemberAssignments(symbol.module, symbol.localName).members.get(member);
        if (assigned) {
          return applyMemberPath(
            resolveExpression(symbol.module, assigned, visited),
            rest,
            visited,
          );
        }
        if (symbol.node.type === "VariableDeclarator" && symbol.node.init) {
          return applyMemberPath(
            resolveExpressionMember(symbol.module, symbol.node.init, member, visited),
            rest,
            visited,
          );
        }
        if (symbol.node.type === "ClassDeclaration" || symbol.node.type === "ClassExpression") {
          for (const element of symbol.node.body.body) {
            if (element.type !== "PropertyDefinition" || !element.static || element.computed)
              continue;
            if (
              element.key.type !== "Identifier" ||
              element.key.name !== member ||
              !element.value
            ) {
              continue;
            }
            return applyMemberPath(
              resolveExpression(symbol.module, element.value, visited),
              rest,
              visited,
            );
          }
        }
        return unresolved(symbol.localName, `no member "${member}"`, memberPath);
      }
    }
  };

  const resolveExpressionMember = (
    module: ParsedModule,
    expression: Expression | FunctionNode | Class,
    member: string,
    visited: Set<string>,
  ): LinkedSymbol => {
    if (expression.type === "FunctionDeclaration" || expression.type === "ClassDeclaration") {
      return unresolved(member, "member access on declaration");
    }
    const unwrapped = unwrapExpression(expression);
    if (unwrapped.type === "ObjectExpression") {
      for (const property of unwrapped.properties) {
        if (property.type !== "Property" || property.computed) continue;
        const keyName =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal" && typeof property.key.value === "string"
              ? property.key.value
              : null;
        if (keyName === member) return resolveExpression(module, property.value, visited);
      }
      return unresolved(member, "property not found in object literal");
    }
    const chain = getMemberChain(unwrapped);
    if (chain) return resolveReferenceInternal(module, [...chain, member], visited);
    return unresolved(member, "member access on dynamic expression");
  };

  const resolveExpression = (
    module: ParsedModule,
    expression: Expression,
    visited: Set<string>,
    exportedName = "",
  ): LinkedSymbol => {
    const unwrapped = unwrapExpression(expression);
    const chain = getMemberChain(unwrapped);
    if (chain) {
      const referenced = resolveReferenceInternal(module, chain, visited);
      if (referenced.kind !== "unresolved") return referenced;
    }
    return { kind: "value", module, exportedName, node: unwrapped };
  };

  const resolveBinding = (
    module: ParsedModule,
    binding: Binding,
    memberPath: string[],
    visited: Set<string>,
  ): LinkedSymbol => {
    if (binding.kind === "declaration") {
      const symbol: DeclarationSymbol = {
        kind: "declaration",
        module,
        localName: binding.localName,
        node: binding.node,
      };
      if (
        binding.node.type === "VariableDeclarator" &&
        binding.node.init &&
        binding.node.id.type === "Identifier"
      ) {
        const aliasChain = getMemberChain(binding.node.init);
        if (aliasChain && aliasChain[0] !== binding.localName) {
          const aliasKey = `${module.filePath}::${binding.localName}`;
          if (!visited.has(aliasKey)) {
            visited.add(aliasKey);
            const aliased = resolveReferenceInternal(
              module,
              [...aliasChain, ...memberPath],
              visited,
            );
            if (aliased.kind !== "unresolved") return aliased;
          }
        }
      }
      return applyMemberPath(symbol, memberPath, visited);
    }
    const targetModule = resolveImportedModule(module, binding.moduleRequest);
    if (!targetModule) {
      return describeImport(module, binding.moduleRequest, binding.importedName, memberPath);
    }
    if (binding.importedName === NAMESPACE_IMPORT_NAME) {
      if (memberPath.length === 0) {
        if (
          targetModule.exports.isCommonJs &&
          targetModule.exports.named.has(DEFAULT_EXPORT_NAME)
        ) {
          return resolveExportInternal(targetModule, DEFAULT_EXPORT_NAME, visited);
        }
        return { kind: "namespace", module: targetModule };
      }
      const [member, ...rest] = memberPath;
      return applyMemberPath(resolveExportInternal(targetModule, member, visited), rest, visited);
    }
    return applyMemberPath(
      resolveExportInternal(targetModule, binding.importedName, visited),
      memberPath,
      visited,
    );
  };

  const resolveReferenceInternal = (
    module: ParsedModule,
    chain: string[],
    visited: Set<string>,
  ): LinkedSymbol => {
    const [head, ...memberPath] = chain;
    if (head === undefined) return unresolved("", "empty reference");
    const binding = module.bindings.get(head);
    if (!binding) {
      if (head === "React") return external("react", "react", NAMESPACE_IMPORT_NAME, memberPath);
      return unresolved(head, "no top-level binding", memberPath);
    }
    return resolveBinding(module, binding, memberPath, visited);
  };

  const resolveExportInternal = (
    module: ParsedModule,
    exportedName: string,
    visited: Set<string>,
  ): LinkedSymbol => {
    const key = `${module.filePath}#${exportedName}`;
    if (visited.has(key)) return unresolved(exportedName, "cyclic re-export");
    visited.add(key);
    const named = module.exports.named.get(exportedName);
    if (named) {
      switch (named.kind) {
        case "local": {
          const binding = module.bindings.get(named.localName);
          if (!binding) return unresolved(named.localName, "exported name has no binding");
          return resolveBinding(module, binding, [], visited);
        }
        case "value":
          if (named.node.type === "FunctionDeclaration" || named.node.type === "ClassDeclaration") {
            return { kind: "value", module, exportedName, node: named.node };
          }
          return resolveExpression(module, named.node, visited, exportedName);
        case "reexport": {
          const targetModule = resolveImportedModule(module, named.moduleRequest);
          if (!targetModule)
            return describeImport(module, named.moduleRequest, named.importedName, []);
          if (named.importedName === NAMESPACE_IMPORT_NAME) {
            return { kind: "namespace", module: targetModule };
          }
          return resolveExportInternal(targetModule, named.importedName, visited);
        }
      }
    }
    if (exportedName !== DEFAULT_EXPORT_NAME) {
      for (const star of module.exports.stars) {
        const targetModule = resolveImportedModule(module, star.moduleRequest);
        if (!targetModule) continue;
        const symbol = resolveExportInternal(targetModule, exportedName, visited);
        if (symbol.kind !== "unresolved") return symbol;
      }
    }
    if (exportedName === DEFAULT_EXPORT_NAME && module.exports.isCommonJs) {
      return { kind: "namespace", module };
    }
    if (module.exports.stars.length > 0 && exportedName !== DEFAULT_EXPORT_NAME) {
      const externalStar = module.exports.stars.find(
        (star) => resolveImportedModule(module, star.moduleRequest) === null,
      );
      if (externalStar) return describeImport(module, externalStar.moduleRequest, exportedName, []);
    }
    return unresolved(exportedName, `not exported from ${module.filePath}`);
  };

  return {
    resolveReference: (module, chain) => resolveReferenceInternal(module, chain, new Set()),
    resolveExport: (module, exportedName) => resolveExportInternal(module, exportedName, new Set()),
    resolveImportedModule,
    getMemberAssignments,
  };
};
