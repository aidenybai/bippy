import type { NodePath } from "@babel/core";
import * as syntax from "@babel/types";

export const getCaptureManifest = (
  closurePath: NodePath<syntax.Function>,
): syntax.ObjectExpression => {
  const bindings = new Set<NonNullable<ReturnType<typeof closurePath.scope.getBinding>>>();
  const ambientNames = new Set<string>();
  let capturesThis = false;
  let capturesArguments = false;
  const isLexical = (reference: NodePath): boolean => {
    let child = reference;
    let parent = reference.parentPath;
    while (parent && parent !== closurePath) {
      if (
        (parent.isFunction() &&
          !parent.isArrowFunctionExpression() &&
          (child.key === "body" || child.listKey === "params")) ||
        ((parent.isClassProperty() || parent.isClassPrivateProperty()) && child.key === "value") ||
        parent.isStaticBlock()
      )
        return false;
      child = parent;
      parent = parent.parentPath;
    }
    return closurePath.isArrowFunctionExpression();
  };
  closurePath.traverse({
    PrivateName: () => {
      ambientNames.add("[[PrivateEnvironment]]");
    },
    ThisExpression: (reference) => {
      if (isLexical(reference)) capturesThis = true;
    },
    Super: (reference) => {
      if (isLexical(reference)) ambientNames.add("[[HomeObject]]");
    },
    MetaProperty: (reference) => {
      if (isLexical(reference) && syntax.isIdentifier(reference.node.meta, { name: "new" }))
        ambientNames.add("[[NewTarget]]");
    },
    Identifier: (referencePath) => {
      const isReference = syntax.isReferenced(
        referencePath.node,
        referencePath.parent,
        referencePath.parentPath?.parent,
      );
      if (
        !isReference &&
        !syntax.isBinding(
          referencePath.node,
          referencePath.parent,
          referencePath.parentPath?.parent,
        )
      )
        return;
      const binding = referencePath.scope.getBinding(referencePath.node.name);
      if (!binding) {
        if (referencePath.node.name === "arguments") {
          if (isLexical(referencePath)) {
            if (
              closurePath.findParent(
                (parent) => parent.isFunction() && !parent.isArrowFunctionExpression(),
              )
            )
              capturesArguments = true;
            else ambientNames.add("arguments");
          }
        } else if (isReference) ambientNames.add(referencePath.node.name);
        return;
      }
      let scope = binding.scope;
      while (scope !== closurePath.scope && scope.parent) scope = scope.parent;
      if (scope !== closurePath.scope) bindings.add(binding);
    },
  });
  const captured = [...bindings].map((binding) => {
    const identifier = binding.identifier;
    const properties = [
      syntax.objectProperty(syntax.identifier("name"), syntax.stringLiteral(identifier.name)),
      syntax.objectProperty(
        syntax.identifier("get"),
        syntax.arrowFunctionExpression([], syntax.cloneNode(identifier)),
      ),
    ];
    if (!binding.constant && binding.kind !== "module") {
      const argument = closurePath.scope.generateUidIdentifier("capturedValue");
      properties.push(
        syntax.objectProperty(
          syntax.identifier("set"),
          syntax.arrowFunctionExpression(
            [argument],
            syntax.assignmentExpression(
              "=",
              syntax.cloneNode(identifier),
              syntax.cloneNode(argument),
            ),
          ),
        ),
      );
    }
    return syntax.objectExpression(properties);
  });
  if (capturesThis)
    captured.push(
      syntax.objectExpression([
        syntax.objectProperty(syntax.identifier("name"), syntax.stringLiteral("[[ThisValue]]")),
        syntax.objectProperty(
          syntax.identifier("get"),
          syntax.arrowFunctionExpression([], syntax.thisExpression()),
        ),
      ]),
    );
  if (capturesArguments)
    captured.push(
      syntax.objectExpression([
        syntax.objectProperty(syntax.identifier("name"), syntax.stringLiteral("[[Arguments]]")),
        syntax.objectProperty(
          syntax.identifier("get"),
          syntax.arrowFunctionExpression([], syntax.identifier("arguments")),
        ),
      ]),
    );
  return syntax.objectExpression([
    syntax.objectProperty(syntax.identifier("bindings"), syntax.arrayExpression(captured)),
    syntax.objectProperty(
      syntax.identifier("ambientNames"),
      syntax.arrayExpression([...ambientNames].map((name) => syntax.stringLiteral(name))),
    ),
  ]);
};
