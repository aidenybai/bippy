import type {
  BindingPattern,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ModuleExportName,
  Statement,
  VariableDeclaration,
} from "oxc-parser";
import type {
  ExportEntry,
  ImportBinding,
  ImportedName,
  MemberAssignment,
  ModuleRecord,
  ParsedSourceFile,
  TopLevelBinding,
} from "../types.js";

const getModuleExportName = (name: ModuleExportName): string =>
  name.type === "Literal" ? name.value : name.name;

const collectPatternNames = (pattern: BindingPattern, names: string[]): void => {
  switch (pattern.type) {
    case "Identifier":
      names.push(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "RestElement") collectPatternNames(property.argument, names);
        else collectPatternNames(property.value, names);
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (!element) continue;
        if (element.type === "RestElement") collectPatternNames(element.argument, names);
        else collectPatternNames(element, names);
      }
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, names);
      return;
  }
};

const collectVariableBindings = (
  declaration: VariableDeclaration,
  bindings: Map<string, TopLevelBinding>,
): string[] => {
  const declaredNames: string[] = [];
  for (const declarator of declaration.declarations) {
    if (declarator.id.type === "Identifier") {
      bindings.set(declarator.id.name, {
        kind: "variable",
        name: declarator.id.name,
        init: declarator.init,
        declarationKind: declaration.kind,
        span: declarator,
      });
      declaredNames.push(declarator.id.name);
      continue;
    }
    const names: string[] = [];
    collectPatternNames(declarator.id, names);
    for (const name of names) {
      bindings.set(name, {
        kind: "destructured",
        name,
        pattern: declarator.id,
        init: declarator.init,
        span: declarator,
      });
      declaredNames.push(name);
    }
  }
  return declaredNames;
};

const collectImports = (declaration: ImportDeclaration, imports: ImportBinding[]): void => {
  const isTypeOnlyDeclaration = declaration.importKind === "type";
  for (const specifier of declaration.specifiers) {
    let imported: ImportedName;
    let isTypeOnly = isTypeOnlyDeclaration;
    switch (specifier.type) {
      case "ImportDefaultSpecifier":
        imported = { kind: "default" };
        break;
      case "ImportNamespaceSpecifier":
        imported = { kind: "namespace" };
        break;
      case "ImportSpecifier":
        imported = { kind: "named", name: getModuleExportName(specifier.imported) };
        isTypeOnly = isTypeOnly || specifier.importKind === "type";
        break;
    }
    imports.push({
      localName: specifier.local.name,
      imported,
      specifier: declaration.source.value,
      isTypeOnly,
      span: specifier,
    });
  }
};

const collectNamedExports = (
  declaration: ExportNamedDeclaration,
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): void => {
  if (declaration.exportKind === "type") return;
  if (declaration.declaration) {
    const declared = declaration.declaration;
    if (declared.type === "VariableDeclaration") {
      for (const name of collectVariableBindings(declared, bindings)) {
        exports.push({ kind: "local", exportedName: name, localName: name });
      }
    } else if (declared.type === "FunctionDeclaration" && declared.id) {
      bindings.set(declared.id.name, {
        kind: "function",
        name: declared.id.name,
        node: declared,
        span: declared,
      });
      exports.push({ kind: "local", exportedName: declared.id.name, localName: declared.id.name });
    } else if (declared.type === "ClassDeclaration" && declared.id) {
      bindings.set(declared.id.name, {
        kind: "class",
        name: declared.id.name,
        node: declared,
        span: declared,
      });
      exports.push({ kind: "local", exportedName: declared.id.name, localName: declared.id.name });
    }
    return;
  }
  for (const specifier of declaration.specifiers) {
    if (specifier.exportKind === "type") continue;
    const exportedName = getModuleExportName(specifier.exported);
    const localName = getModuleExportName(specifier.local);
    if (declaration.source) {
      exports.push({
        kind: "re-export",
        exportedName,
        imported:
          localName === "default" ? { kind: "default" } : { kind: "named", name: localName },
        specifier: declaration.source.value,
      });
    } else {
      exports.push({ kind: "local", exportedName, localName });
    }
  }
};

const collectDefaultExport = (
  declaration: ExportDefaultDeclaration,
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): void => {
  const declared = declaration.declaration;
  if (declared.type === "TSInterfaceDeclaration") return;
  if (declared.type === "FunctionDeclaration" && declared.id) {
    bindings.set(declared.id.name, {
      kind: "function",
      name: declared.id.name,
      node: declared,
      span: declared,
    });
    exports.push({ kind: "local", exportedName: "default", localName: declared.id.name });
    return;
  }
  if (declared.type === "ClassDeclaration" && declared.id) {
    bindings.set(declared.id.name, {
      kind: "class",
      name: declared.id.name,
      node: declared,
      span: declared,
    });
    exports.push({ kind: "local", exportedName: "default", localName: declared.id.name });
    return;
  }
  if (declared.type === "TSDeclareFunction" || declared.type === "TSEmptyBodyFunctionExpression") {
    return;
  }
  exports.push({ kind: "expression", exportedName: "default", expression: declared });
};

const collectStatement = (
  statement: Statement,
  imports: ImportBinding[],
  exports: ExportEntry[],
  bindings: Map<string, TopLevelBinding>,
): void => {
  switch (statement.type) {
    case "ImportDeclaration":
      collectImports(statement, imports);
      return;
    case "ExportNamedDeclaration":
      collectNamedExports(statement, bindings, exports);
      return;
    case "ExportDefaultDeclaration":
      collectDefaultExport(statement, bindings, exports);
      return;
    case "ExportAllDeclaration":
      if (statement.exportKind === "type") return;
      if (statement.exported) {
        exports.push({
          kind: "re-export",
          exportedName: getModuleExportName(statement.exported),
          imported: { kind: "namespace" },
          specifier: statement.source.value,
        });
      } else {
        exports.push({ kind: "re-export-all", specifier: statement.source.value });
      }
      return;
    case "VariableDeclaration":
      collectVariableBindings(statement, bindings);
      return;
    case "FunctionDeclaration":
      if (statement.id) {
        bindings.set(statement.id.name, {
          kind: "function",
          name: statement.id.name,
          node: statement,
          span: statement,
        });
      }
      return;
    case "ClassDeclaration":
      if (statement.id) {
        bindings.set(statement.id.name, {
          kind: "class",
          name: statement.id.name,
          node: statement,
          span: statement,
        });
      }
      return;
    default:
      return;
  }
};

const collectMemberAssignment = (
  statement: Statement,
  memberAssignments: MemberAssignment[],
): void => {
  if (statement.type !== "ExpressionStatement") return;
  const expression = statement.expression;
  if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return;
  const target = expression.left;
  if (target.type !== "MemberExpression" || target.computed) return;
  if (target.object.type !== "Identifier" || target.property.type !== "Identifier") return;
  memberAssignments.push({
    objectName: target.object.name,
    propertyName: target.property.name,
    value: expression.right,
    span: statement,
  });
};

export const createModuleRecord = (file: ParsedSourceFile): ModuleRecord => {
  const imports: ImportBinding[] = [];
  const exports: ExportEntry[] = [];
  const bindings = new Map<string, TopLevelBinding>();
  const memberAssignments: MemberAssignment[] = [];
  for (const statement of file.program.body) {
    if (
      statement.type === "ExpressionStatement" &&
      "directive" in statement &&
      statement.directive
    ) {
      continue;
    }
    collectStatement(statement, imports, exports, bindings);
    collectMemberAssignment(statement, memberAssignments);
  }
  for (const importBinding of imports) {
    if (importBinding.isTypeOnly) continue;
    bindings.set(importBinding.localName, {
      kind: "import",
      name: importBinding.localName,
      binding: importBinding,
      span: importBinding.span,
    });
  }
  return { filePath: file.filePath, file, imports, exports, bindings, memberAssignments };
};
