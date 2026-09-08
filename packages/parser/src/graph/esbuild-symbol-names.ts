import type {
  BindingPattern,
  Class,
  Expression,
  Function as FunctionNode,
  FunctionBody,
  Node,
  ParamPattern,
  Program,
} from "oxc-parser";
import { forEachChildNode, getPatternNames } from "../parse/ast-walk.js";

type NamedDeclaration = FunctionNode | Class;

interface ScopeTree {
  parent: ScopeTree | null;
  members: DeclaredSymbol[];
  children: ScopeTree[];
}

interface DeclaredSymbol {
  name: string;
  declaration: NamedDeclaration | null;
  isRecordedAtTopLevel: boolean;
  isReserved: boolean;
}

interface NumberScope {
  parent: NumberScope | null;
  nameCounts: Map<string, number>;
}

type NameUse = "unused" | "used" | "used-in-same-scope";

const findNameUse = (scope: NumberScope, name: string): NameUse => {
  for (let current: NumberScope | null = scope; current; current = current.parent) {
    if (current.nameCounts.has(name)) return current === scope ? "used-in-same-scope" : "used";
  }
  return "unused";
};

const findUnusedName = (scope: NumberScope, originalName: string): string => {
  const use = findNameUse(scope, originalName);
  let name = originalName;
  if (use !== "unused") {
    let tries = use === "used-in-same-scope" ? (scope.nameCounts.get(originalName) ?? 1) : 1;
    do {
      tries += 1;
      name = `${originalName}${tries}`;
    } while (findNameUse(scope, name) !== "unused");
    if (use === "used-in-same-scope") scope.nameCounts.set(originalName, tries);
  }
  scope.nameCounts.set(name, 1);
  return name;
};

const createScope = (parent: ScopeTree | null): ScopeTree => {
  const scope: ScopeTree = { parent, members: [], children: [] };
  parent?.children.push(scope);
  return scope;
};

interface ModuleSymbols {
  moduleScope: ScopeTree;
  topLevelInVisitOrder: DeclaredSymbol[];
  hasImportOrExport: boolean;
}

const collectModuleSymbols = (program: Program): ModuleSymbols => {
  const moduleScope = createScope(null);
  const topLevelInVisitOrder: DeclaredSymbol[] = [];
  let hasImportOrExport = false;

  const declare = (
    scope: ScopeTree,
    hoistScope: ScopeTree,
    name: string,
    declaration: NamedDeclaration | null = null,
    isReserved = false,
  ): void => {
    const symbol: DeclaredSymbol = {
      name,
      declaration,
      isRecordedAtTopLevel: scope === moduleScope,
      isReserved,
    };
    hoistScope.members.push(symbol);
    if (symbol.isRecordedAtTopLevel) topLevelInVisitOrder.push(symbol);
  };

  const declarePattern = (
    scope: ScopeTree,
    hoistScope: ScopeTree,
    pattern: BindingPattern,
    isReserved = false,
  ): void => {
    for (const name of getPatternNames(pattern)) declare(scope, hoistScope, name, null, isReserved);
  };

  const visitFunction = (node: FunctionNode, scope: ScopeTree, isExported = false): void => {
    if (node.declare) return;
    const argumentsScope = createScope(scope);
    if (node.id) {
      const nameScope = node.type === "FunctionDeclaration" ? scope : argumentsScope;
      declare(scope, nameScope, node.id.name, node, isExported);
    }
    visitFunctionLike(node.params, node.body, argumentsScope);
  };

  const visitFunctionLike = (
    params: ParamPattern[],
    body: FunctionBody | Expression | null,
    argumentsScope: ScopeTree,
  ): void => {
    for (const parameter of params) {
      const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
      if (pattern.type === "RestElement") {
        declarePattern(argumentsScope, argumentsScope, pattern.argument);
      } else {
        declarePattern(argumentsScope, argumentsScope, pattern);
        if (pattern.type === "AssignmentPattern")
          visit(pattern.right, argumentsScope, argumentsScope);
      }
    }
    if (!body) return;
    const bodyScope = createScope(argumentsScope);
    if (body.type === "BlockStatement") {
      for (const statement of body.body) visit(statement, bodyScope, bodyScope);
    } else {
      visit(body, bodyScope, bodyScope);
    }
  };

  const visitClass = (node: Class, scope: ScopeTree, isExported = false): void => {
    if (node.declare) return;
    const nameScope = createScope(scope);
    if (node.id && (node.type === "ClassDeclaration" || scope === moduleScope)) {
      const targetScope = node.type === "ClassDeclaration" ? scope : nameScope;
      declare(scope, targetScope, node.id.name, node, isExported);
    }
    if (node.superClass) visit(node.superClass, nameScope, nameScope);
    const bodyScope = createScope(nameScope);
    for (const element of node.body.body) visit(element, bodyScope, bodyScope);
  };

  const visitChildren = (node: Node, scope: ScopeTree, hoistScope: ScopeTree): void =>
    forEachChildNode(node, (child) => visit(child, scope, hoistScope));

  const visit = (node: Node, scope: ScopeTree, hoistScope: ScopeTree): void => {
    switch (node.type) {
      case "ImportDeclaration":
        hasImportOrExport = true;
        if (node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
          declare(scope, hoistScope, specifier.local.name);
        }
        return;
      case "ExportNamedDeclaration":
        hasImportOrExport = true;
        if (node.declaration) visitDeclaration(node.declaration, scope, hoistScope, true);
        return;
      case "ExportDefaultDeclaration":
        hasImportOrExport = true;
        visit(node.declaration, scope, hoistScope);
        return;
      case "ExportAllDeclaration":
        hasImportOrExport = true;
        return;
      case "VariableDeclaration":
      case "TSEnumDeclaration":
      case "TSModuleDeclaration":
        visitDeclaration(node, scope, hoistScope, false);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
        visitFunction(node, scope);
        return;
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
      case "TSTypeAliasDeclaration":
      case "TSInterfaceDeclaration":
        return;
      case "ArrowFunctionExpression":
        visitFunctionLike(node.params, node.body, createScope(scope));
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        visitClass(node, scope);
        return;
      case "CatchClause": {
        const catchScope = createScope(scope);
        if (node.param) declarePattern(catchScope, catchScope, node.param);
        const blockScope = createScope(catchScope);
        for (const statement of node.body.body) visit(statement, blockScope, hoistScope);
        return;
      }
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "SwitchStatement":
      case "StaticBlock": {
        const blockScope = createScope(scope);
        visitChildren(node, blockScope, node.type === "StaticBlock" ? blockScope : hoistScope);
        return;
      }
      default:
        visitChildren(node, scope, hoistScope);
    }
  };

  const visitDeclaration = (
    node: Node,
    scope: ScopeTree,
    hoistScope: ScopeTree,
    isExported: boolean,
  ): void => {
    switch (node.type) {
      case "VariableDeclaration":
        if (node.declare) return;
        for (const declarator of node.declarations) {
          const target = node.kind === "var" ? hoistScope : scope;
          declarePattern(scope, target, declarator.id, isExported);
          if (declarator.init) visit(declarator.init, scope, hoistScope);
        }
        return;
      case "TSEnumDeclaration":
        if (!node.declare) declare(scope, hoistScope, node.id.name, null, true);
        return;
      case "TSModuleDeclaration":
        if (!node.declare && node.id.type === "Identifier") {
          declare(scope, hoistScope, node.id.name, null, isExported);
        }
        return;
      case "FunctionDeclaration":
        visitFunction(node, scope, isExported);
        return;
      case "ClassDeclaration":
        visitClass(node, scope, isExported);
        return;
      default:
        visit(node, scope, hoistScope);
    }
  };

  for (const statement of program.body) visit(statement, moduleScope, moduleScope);
  return { moduleScope, topLevelInVisitOrder, hasImportOrExport };
};

const assignNames = ({ moduleScope, topLevelInVisitOrder, hasImportOrExport }: ModuleSymbols) => {
  const names = new Map<DeclaredSymbol, string>();
  const root: NumberScope = { parent: null, nameCounts: new Map() };
  for (const symbol of moduleScope.members) {
    if (symbol.isReserved || !hasImportOrExport) {
      root.nameCounts.set(symbol.name, 1);
      names.set(symbol, symbol.name);
    }
  }
  const assignName = (scope: NumberScope, symbol: DeclaredSymbol): void => {
    if (!names.has(symbol)) names.set(symbol, findUnusedName(scope, symbol.name));
  };
  for (const symbol of topLevelInVisitOrder) assignName(root, symbol);
  const assignNamesRecursive = (scope: ScopeTree, parent: NumberScope): void => {
    let numberScope = parent;
    if (scope.members.length > 0) {
      numberScope = { parent, nameCounts: new Map() };
      for (const symbol of scope.members) assignName(numberScope, symbol);
    }
    for (const child of scope.children) assignNamesRecursive(child, numberScope);
  };
  assignNamesRecursive(moduleScope, root);
  return names;
};

const computeDeclarationNames = (program: Program): Map<NamedDeclaration, string> => {
  const symbols = collectModuleSymbols(program);
  const names = assignNames(symbols);
  const declarationNames = new Map<NamedDeclaration, string>();
  for (const [symbol, name] of names) {
    if (symbol.declaration) declarationNames.set(symbol.declaration, name);
  }
  return declarationNames;
};

const declarationNamesByProgram = new WeakMap<Program, Map<NamedDeclaration, string>>();

/** Mirrors esbuild's `NumberRenamer`: `const Foo = memo(function Foo() {})` runs as `Foo2`. */
export const getEsbuildDeclarationName = (
  program: Program,
  declaration: NamedDeclaration,
): string | null => {
  let declarationNames = declarationNamesByProgram.get(program);
  if (!declarationNames) {
    declarationNames = computeDeclarationNames(program);
    declarationNamesByProgram.set(program, declarationNames);
  }
  return declarationNames.get(declaration) ?? null;
};
