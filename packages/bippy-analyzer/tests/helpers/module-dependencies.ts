import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface ModuleDependency {
  source: string;
  target: string;
  isTypeOnly: boolean;
}

interface ModuleVisit {
  index: number;
  lowlink: number;
  isActive: boolean;
}

const getModuleName = (directory: string, filePath: string): string =>
  relative(directory, filePath).split(sep).join("/").replace(/\.js$/, ".ts");

export const getModuleDependencies = (
  directory: string,
  filePath: string,
  content: string,
): ModuleDependency[] => {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const dependencies: ModuleDependency[] = [];
  const add = (specifier: ts.Node | undefined, isTypeOnly: boolean): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const target =
      specifier.text === "bippy-analyzer"
        ? resolve(directory, "index.ts")
        : specifier.text === "bippy-analyzer/harness"
          ? resolve(directory, "harness/index.ts")
          : specifier.text.startsWith(".")
            ? resolve(dirname(filePath), specifier.text)
            : null;
    if (target !== null)
      dependencies.push({
        source: getModuleName(directory, filePath),
        target: getModuleName(directory, target),
        isTypeOnly,
      });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      add(
        node.moduleSpecifier,
        !!clause?.isTypeOnly ||
          !!(
            !clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)
          ),
      );
    } else if (ts.isExportDeclaration(node)) {
      const bindings = node.exportClause;
      add(
        node.moduleSpecifier,
        node.isTypeOnly ||
          !!(
            bindings &&
            ts.isNamedExports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)
          ),
      );
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      add(node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dependencies;
};

export const getDependencyCycles = (dependencies: ModuleDependency[]): string[][] => {
  const graph = new Map<string, Set<string>>();
  for (const { source, target } of dependencies) {
    const targets = graph.get(source) ?? new Set<string>();
    targets.add(target);
    graph.set(source, targets);
  }
  const visits = new Map<string, ModuleVisit>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (module: string): ModuleVisit => {
    const current = { index: visits.size, lowlink: visits.size, isActive: true };
    visits.set(module, current);
    stack.push(module);
    for (const target of graph.get(module) ?? []) {
      const known = visits.get(target);
      if (!known) current.lowlink = Math.min(current.lowlink, visit(target).lowlink);
      else if (known.isActive) current.lowlink = Math.min(current.lowlink, known.index);
    }
    if (current.lowlink === current.index) {
      const component: string[] = [];
      let member = stack.pop();
      while (member !== undefined) {
        component.push(member);
        const visited = visits.get(member);
        if (visited) visited.isActive = false;
        if (member === module) break;
        member = stack.pop();
      }
      if (component.length > 1 || graph.get(module)?.has(module)) cycles.push(component.sort());
    }
    return current;
  };
  for (const module of graph.keys()) if (!visits.has(module)) visit(module);
  return cycles.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
};
