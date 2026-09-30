import type { NodePath, PluginObject } from "@babel/core";
import * as syntax from "@babel/types";
import { getCaptureManifest } from "./capture-manifest.js";
import { capturesSpecifier, controlSpecifier } from "./control-paths.js";

interface ScopeRegistrations {
  path: NodePath<syntax.Program | syntax.BlockStatement>;
  statements: syntax.Statement[];
}

const getInferredName = (
  path: NodePath<
    syntax.FunctionExpression | syntax.ArrowFunctionExpression | syntax.ClassExpression
  >,
): string | undefined | false => {
  if (
    (syntax.isFunctionExpression(path.node) || syntax.isClassExpression(path.node)) &&
    path.node.id
  )
    return undefined;
  const parent = path.parent;
  if (syntax.isVariableDeclarator(parent) && syntax.isIdentifier(parent.id)) return parent.id.name;
  if (syntax.isAssignmentExpression(parent) && syntax.isIdentifier(parent.left))
    return ["=", "&&=", "||=", "??="].includes(parent.operator) ? parent.left.name : undefined;
  if (syntax.isAssignmentPattern(parent) && syntax.isIdentifier(parent.left))
    return parent.left.name;
  if (syntax.isExportDefaultDeclaration(parent)) return "default";
  if (
    syntax.isObjectProperty(parent) ||
    syntax.isClassProperty(parent) ||
    syntax.isClassPrivateProperty(parent)
  ) {
    if ("computed" in parent && parent.computed) return false;
    if (
      syntax.isObjectProperty(parent) &&
      (syntax.isIdentifier(parent.key, { name: "__proto__" }) ||
        syntax.isStringLiteral(parent.key, { value: "__proto__" }))
    )
      return undefined;
    if (syntax.isIdentifier(parent.key)) return parent.key.name;
    if (syntax.isStringLiteral(parent.key)) return parent.key.value;
    if (syntax.isNumericLiteral(parent.key)) return String(parent.key.value);
    if (syntax.isPrivateName(parent.key)) return `#${parent.key.id.name}`;
    return false;
  }
  return undefined;
};

const getNamedClosure = (
  path: NodePath<
    syntax.FunctionExpression | syntax.ArrowFunctionExpression | syntax.ClassExpression
  >,
): syntax.Expression | undefined => {
  const name = getInferredName(path);
  if (name === false) return undefined;
  if (name === undefined) return path.node;
  return syntax.memberExpression(
    syntax.objectExpression([syntax.objectProperty(syntax.stringLiteral(name), path.node, true)]),
    syntax.stringLiteral(name),
    true,
  );
};

const isControlCall = (
  path: NodePath<syntax.Function>,
  call: syntax.CallExpression,
  member: string,
): boolean => {
  const callee = call.callee;
  if (
    !syntax.isMemberExpression(callee) ||
    !syntax.isIdentifier(callee.property, { name: member }) ||
    !syntax.isCallExpression(callee.object) ||
    !syntax.isIdentifier(callee.object.callee)
  )
    return false;
  const binding = path.scope.getBinding(callee.object.callee.name);
  return (
    !!binding?.path.isImportSpecifier() &&
    syntax.isIdentifier(binding.path.node.imported, { name: "executionMachine" }) &&
    binding.path.parentPath.isImportDeclaration() &&
    binding.path.parentPath.node.source.value === controlSpecifier
  );
};

const isControlArgument = (path: NodePath<syntax.Function>, index: number, member = "w"): boolean =>
  syntax.isCallExpression(path.parent) &&
  path.parent.arguments[index] === path.node &&
  isControlCall(path, path.parent, member);

const isImmediateControlFactory = (path: NodePath<syntax.Function>): boolean => {
  if (!path.isFunctionExpression() || path.node.params.length || !isControlArgument(path, 0, "m"))
    return false;
  if (
    path.node.body.body
      .slice(0, -1)
      .some(
        (statement) =>
          !syntax.isVariableDeclaration(statement) ||
          statement.declarations.some((declaration) => declaration.init),
      )
  )
    return false;
  const invocation = path.parentPath.parentPath;
  if (!invocation?.isCallExpression() || invocation.node.callee !== path.parent) return false;
  const returned = path.node.body.body.at(-1);
  if (!syntax.isReturnStatement(returned) || !syntax.isCallExpression(returned.argument))
    return false;
  if (!isControlCall(path, returned.argument, "w")) return false;
  const locals = returned.argument.arguments[4];
  if (!syntax.isObjectExpression(locals)) return false;
  const name = path.node.id?.name;
  return (
    !name ||
    !locals.properties.some(
      (property) =>
        syntax.isObjectProperty(property) && syntax.isIdentifier(property.key, { name }),
    )
  );
};

export const nativeCaptures = (): PluginObject => {
  const manifests = new WeakMap<syntax.Node, syntax.ObjectExpression>();
  const scopes = new Map<syntax.Node, ScopeRegistrations>();
  const processed = new WeakSet<syntax.Node>();
  let helper: syntax.Identifier;
  let isUsed = false;
  return {
    visitor: {
      Program: {
        enter: (path) => {
          helper = path.scope.generateUidIdentifier("registerNativeClosure");
        },
        exit: (path) => {
          for (const registration of scopes.values())
            registration.path.unshiftContainer("body", registration.statements);
          if (isUsed)
            path.unshiftContainer(
              "body",
              syntax.importDeclaration(
                [syntax.importSpecifier(helper, syntax.identifier("registerNativeClosure"))],
                syntax.stringLiteral(capturesSpecifier),
              ),
            );
        },
      },
      Class: {
        enter: (path) => {
          if (processed.has(path.node)) return;
          manifests.set(path.node, getCaptureManifest(path));
        },
        exit: (path) => {
          const captures = manifests.get(path.node);
          if (!captures || processed.has(path.node)) return;
          processed.add(path.node);
          const factory = syntax.arrowFunctionExpression([], captures);
          processed.add(factory);
          if (path.isClassDeclaration()) {
            if (!path.node.id) return;
            const statement = path.parentPath.isExportDeclaration() ? path.parentPath : path;
            statement.insertAfter(
              syntax.expressionStatement(
                syntax.callExpression(syntax.cloneNode(helper), [
                  syntax.cloneNode(path.node.id),
                  factory,
                ]),
              ),
            );
            isUsed = true;
          } else if (path.isClassExpression()) {
            const closure = getNamedClosure(path);
            if (!closure) return;
            isUsed = true;
            path.replaceWith(syntax.callExpression(syntax.cloneNode(helper), [closure, factory]));
            path.skip();
          }
        },
      },
      Function: {
        enter: (path) => {
          if (processed.has(path.node) || isControlArgument(path, 5)) {
            path.skip();
            return;
          }
          if (isControlArgument(path, 0) || isImmediateControlFactory(path)) return;
          if (
            path.isArrowFunctionExpression() ||
            path.isFunctionExpression() ||
            path.isFunctionDeclaration()
          )
            manifests.set(path.node, getCaptureManifest(path));
        },
        exit: (path) => {
          const captures = manifests.get(path.node);
          if (!captures || processed.has(path.node)) return;
          processed.add(path.node);
          const factory = syntax.arrowFunctionExpression([], captures);
          processed.add(factory);
          if (path.isFunctionDeclaration()) {
            if (!path.node.id) return;
            const parent = path.parentPath.isExportDeclaration()
              ? path.parentPath.parentPath
              : path.parentPath;
            if (!parent?.isProgram() && !parent?.isBlockStatement()) return;
            const registration: ScopeRegistrations = scopes.get(parent.node) ?? {
              path: parent,
              statements: [],
            };
            registration.statements.push(
              syntax.expressionStatement(
                syntax.callExpression(syntax.cloneNode(helper), [
                  syntax.cloneNode(path.node.id),
                  factory,
                ]),
              ),
            );
            scopes.set(parent.node, registration);
            isUsed = true;
          } else if (path.isFunctionExpression() || path.isArrowFunctionExpression()) {
            const closure = getNamedClosure(path);
            if (!closure) return;
            isUsed = true;
            path.replaceWith(syntax.callExpression(syntax.cloneNode(helper), [closure, factory]));
            path.skip();
          }
        },
      },
    },
  };
};
