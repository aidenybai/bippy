// @ts-nocheck
import {
  type NodePath,
  traverse,
  template,
  type PluginObject, type PluginPass,
  types as t,
} from '@babel/core';

// For frequently used Record-like classes, inline them to get a better debug experience.
const Structs = [
  'AsyncGeneratorRequestRecord',
  'ClassElementDefinitionRecord',
  'ClassFieldDefinitionRecord',
  'ClassStaticBlockDefinitionRecord',
  'PrivateElementRecord',
];

const Completions = {
  NormalCompletion(source: NodeWithLocation, code: { value: t.Expression }) {
    return withSource(source, template('({ __proto__: NormalCompletion.prototype, Value: %%value%% })', parseOptions)(code))[0];
  },
  ThrowCompletion(source: NodeWithLocation, code: { value: t.Expression }) {
    return withSource(source, template('({ __proto__: ThrowCompletion.prototype, Value: %%value%% })', parseOptions)(code))[0];
  },
};

const Macros = {
  Assert: {
    template: (source: NodeWithLocation, code: { test: t.Expression, testStr: t.Expression }) => withSource(source, template(`
    /* Assert */ /* node:coverage ignore next */ if (!(%%test%%)) throw new Assert.Error(%%testStr%%);
    `, parseOptions)(code))[0],
    imports: [],
    allowAnyExpression: true,
    expressionOnlyUsedOnce: true,
  },
  ReturnIfAbrupt: {
    template: (source: NodeWithLocation, code: { value: t.Expression }) => withSource(source, template(`
    /* ReturnIfAbrupt */
    if (%%value%% instanceof Completion) {
      if (%%value%% instanceof AbruptCompletion) return %%value%%;
      %%value%% = %%value%%.Value;
    }
    `, parseOptions)(code)),
    imports: ['AbruptCompletion', 'Completion', 'Assert'],
    allowAnyExpression: true,
    expressionOnlyUsedOnce: false,
  },
  X: {
    template: (source: NodeWithLocation, code: { value: t.Expression, checkYieldStar: t.Statement | null, source: t.Expression }) => withSource(source, template(`
    /* X */
    %%checkYieldStar%%
    /* node:coverage ignore next */ if (%%value%% instanceof Completion) {
      /* node:coverage ignore next */ if (%%value%% instanceof AbruptCompletion) throw new Assert.Error(%%source%%, { cause: %%value%% });
      %%value%% = %%value%%.Value;
    }
    `, parseOptions)(code)),
    imports: ['Assert', 'Completion', 'AbruptCompletion', 'skipDebugger'],
    allowAnyExpression: true,
    expressionOnlyUsedOnce: false,
  },
  IfAbruptCloseIterator: {
    template: (source: NodeWithLocation, code: { value: t.Expression, iteratorRecord: t.Expression }) => withSource(source, template(`
    /* IfAbruptCloseIterator */
    /* node:coverage ignore next */
    if (%%value%% instanceof AbruptCompletion) return skipDebugger(IteratorClose(%%iteratorRecord%%, %%value%%));
    /* node:coverage ignore next */
    if (%%value%% instanceof Completion) %%value%% = %%value%%.Value;
    `, parseOptions)(code)),
    imports: ['IteratorClose', 'AbruptCompletion', 'Completion', 'skipDebugger'],
    allowAnyExpression: false,
    expressionOnlyUsedOnce: false,
  },
  IfAbruptCloseIterators: {
    template: (source: NodeWithLocation, code: { value: t.Expression, iteratorRecord: t.Expression }) => withSource(source, template(`
    /* IfAbruptCloseIterators */
    /* node:coverage ignore next */
    if (%%value%% instanceof AbruptCompletion) return yield* IteratorCloseAll(%%iteratorRecord%%, %%value%%);
    /* node:coverage ignore next */
    if (%%value%% instanceof Completion) %%value%% = %%value%%.Value;
    `, parseOptions)(code)),
    imports: ['IteratorCloseAll', 'AbruptCompletion', 'Completion', 'skipDebugger'],
    allowAnyExpression: false,
    expressionOnlyUsedOnce: false,
  },
  IfAbruptCloseAsyncIterator: {
    template: (source: NodeWithLocation, code: { value: t.Expression, iteratorRecord: t.Expression }) => withSource(source, template(`
    /* IfAbruptCloseAsyncIterator */
    /* node:coverage ignore next */
    if (%%value%% instanceof AbruptCompletion) return yield* AsyncIteratorClose(%%iteratorRecord%%, %%value%%);
    /* node:coverage ignore next */
    if (%%value%% instanceof Completion) %%value%% = %%value%%.Value;
    `, parseOptions)(code)),
    imports: ['Assert', 'AsyncIteratorClose', 'AbruptCompletion', 'Completion', 'skipDebugger'],
    allowAnyExpression: false,
    expressionOnlyUsedOnce: false,
  },
  IfAbruptRejectPromise: {
    template: (source: NodeWithLocation, code: { value: t.Expression, capability: t.Expression }) => withSource(source, template(`
    /* IfAbruptRejectPromise */
    /* node:coverage disable */
    if (%%value%% instanceof AbruptCompletion) {
      const callRejectCompletion = skipDebugger(Call(%%capability%%.Reject, Value.undefined, [%%value%%.Value]));
      if (callRejectCompletion instanceof AbruptCompletion) return callRejectCompletion;
      return %%capability%%.Promise;
    }
    if (%%value%% instanceof Completion) %%value%% = %%value%%.Value;
    /* node:coverage enable */
    `, parseOptions)(code)),
    imports: ['Call', 'Value', 'AbruptCompletion', 'Completion', 'skipDebugger'],
    allowAnyExpression: false,
    expressionOnlyUsedOnce: false,
  },
  Throw: {
    template: (source: NodeWithLocation, code: { value: t.Expression }) => withSource(source, template(`
    /* Throw */ return ThrowCompletion(%%value%%);
    `, parseOptions)(code)),
    imports: ['ThrowCompletion'],
    allowAnyExpression: true,
    expressionOnlyUsedOnce: true,
  },
} satisfies Record<string, {
  template: (source: NodeWithLocation, code: never) => t.Statement | t.Statement[],
  imports: NeededNames[],
  allowAnyExpression: boolean,
  expressionOnlyUsedOnce: boolean,
}>;

const parseOptions = { preserveComments: true };

type NeededNames = 'Completion' | 'AbruptCompletion' | 'Assert' | 'Call' | 'IteratorClose' | 'IteratorCloseAll' | 'AsyncIteratorClose' | 'Value' | 'skipDebugger' | 'ThrowCompletion';
export default (): PluginObject => ({
  visitor: {
    Program: {
      enter(_path, state) {
        state.needed = Object.create(null);
      },
      exit(path, state) {
        const imports: string[] = [];
        Object.entries(state.needed).forEach(([key, value]) => {
          if (value)imports.push(key);
        });
        if (imports.length) {
          path.unshiftContainer('body', template.ast(`
            import { ${imports.join(',')} } from "#self";
          `));
        }
      },
    },
    CallExpression(path, state) {
      const callee = path.node.callee;
      if (!t.isIdentifier(callee)) return;
      const argument = path.node.arguments[0];

      // Completion optimization
      if (callee.name && callee.name in Completions) {
        const template = Completions[callee.name as keyof typeof Completions];
        if (!t.isExpression(argument)) {
          throw path.get('arguments.0').buildCodeFrameError('First argument to completion macros must be an expression');
        }
        path.replaceWith(template(callee, { value: argument }));
        return;
      }

      // Struct optimization
      if (Structs.includes(callee.name) && path.node.arguments.length === 1) {
        const arg0 = path.node.arguments[0];
        if (t.isObjectExpression(arg0)) {
          path.replaceWith(t.objectExpression([
            t.objectProperty(t.identifier('__proto__'), t.memberExpression(t.identifier(callee.name), t.identifier('prototype'))),
            ...arg0.properties,
          ]));
          return;
        }
      }

      const macroName = (callee.name === 'Q' ? 'ReturnIfAbrupt' : callee.name) as keyof typeof Macros;
      if (!(macroName in Macros)) return;
      if (!t.isExpression(argument)) {
        throw path.get('arguments.0').buildCodeFrameError('First argument to macros must be an expression');
      }

      if (macroName === 'Assert') {
        let arg1 = path.node.arguments[1];
        if (!arg1 || !t.isExpression(arg1)) {
          arg1 = t.stringLiteral(path.get('arguments.0').getSource());
          path.node.arguments.push(arg1);
        }
        if (path.parentPath.isExpressionStatement()) {
          path.parentPath.replaceWith(Macros.Assert.template(callee, { test: argument, testStr: arg1 }));
        }
        return;
      }

      if (withinNotTransformablePosition(path)) {
        throw path.buildCodeFrameError('Macros may not be used within the test of if statements, while statements, for statements, or switch statements');
      }

      const enclosingConditional = getEnclosingConditionalExpression(path);
      if (enclosingConditional !== null) {
        if (enclosingConditional.parentPath.isVariableDeclarator()) {
          const declaration = enclosingConditional.parentPath.parentPath;
          const id = enclosingConditional.parentPath.get('id');
          declaration.replaceWithMultiple([
            template.ast(`let ${id};`) as t.VariableDeclaration,
            t.ifStatement(
              enclosingConditional.get('test').node,
              t.blockStatement([t.expressionStatement(t.assignmentExpression('=', id.node as t.Identifier, enclosingConditional.get('consequent').node))]),
              t.blockStatement([t.expressionStatement(t.assignmentExpression('=', id.node as t.Identifier, enclosingConditional.get('alternate').node))]),
            ),
          ]);
          return;
        } else {
          throw path.buildCodeFrameError('Macros may not be used within conditional expressions');
        }
      }

      if (macroName === 'ReturnIfAbrupt' && (path.parentPath.isReturnStatement() || path.parentPath.isArrowFunctionExpression())) {
        path.replaceWith(path.node.arguments[0]);
        return;
      }

      Macros[macroName].imports.forEach((i) => {
        state.needed[i] = path.scope.getBinding(i) === undefined;
      });

      if (macroName === 'Throw' && (path.parentPath.isReturnStatement() || path.parentPath.isArrowFunctionExpression())) {
        path.replaceWith(Completions.ThrowCompletion(callee, { value: argument }));
        return;
      }

      if (path.parentPath.isArrowFunctionExpression()) {
        throw path.buildCodeFrameError('Macros may not be the sole expression of an arrow function');
      }

      const statementPath = path.findParent((p) => p.isStatement());
      if (!statementPath) {
        throw path.buildCodeFrameError('Internal error: no parent statement found');
      }

      if ((macroName === 'ReturnIfAbrupt' || macroName === 'X') && t.isIdentifier(argument)) {
        const binding = path.scope.getBinding(argument.name)!;
        (binding.path.parent as t.VariableDeclaration).kind = 'let';
        statementPath.insertBefore(Macros.ReturnIfAbrupt.template(callee, { value: argument }));
        if (path.parentPath.isExpressionStatement()) {
          removePath(path);
        } else {
          path.replaceWith(argument);
        }
      } else if (macroName === 'IfAbruptRejectPromise') {
        const [, capability] = path.node.arguments;
        if (!t.isIdentifier(argument)) {
          throw path.get('arguments.0').buildCodeFrameError('First argument to IfAbruptRejectPromise should be an identifier');
        }
        if (!t.isIdentifier(capability)) {
          throw path.get('arguments.1').buildCodeFrameError('Second argument to IfAbruptRejectPromise should be an identifier');
        }
        const binding = path.scope.getBinding(argument.name)!;
        (binding.path.parent as t.VariableDeclaration).kind = 'let';
        statementPath.insertBefore(Macros.IfAbruptRejectPromise.template(callee, { value: argument, capability }));
        removePath(path);
      } else if (macroName === 'IfAbruptCloseIterator' || macroName === 'IfAbruptCloseIterators' || macroName === 'IfAbruptCloseAsyncIterator') {
        if (!t.isIdentifier(argument)) {
          throw path.get('arguments.0').buildCodeFrameError('First argument to IfAbruptCloseIterator should be an identifier');
        }
        const iteratorRecord = path.get('arguments.1');
        if (!iteratorRecord.isIdentifier()) {
          throw iteratorRecord.buildCodeFrameError('Second argument to IfAbruptCloseIterator should be an identifier');
        }
        const binding = path.scope.getBinding(argument.name)!;
        (binding.path.parent as t.VariableDeclaration).kind = 'let';
        statementPath.insertBefore(
          Macros[macroName].template(callee, {
            value: argument,
            iteratorRecord: iteratorRecord.node,
          }),
        );
        removePath(path);
      } else {
        let sideEffect: t.Statement[] = [];
        let id;
        const macro = Macros[macroName];
        if (t.isIdentifier(argument)) {
          id = argument;
        } else if (macro.allowAnyExpression) {
          if (macro.expressionOnlyUsedOnce) {
            id = argument;
          } else {
            // find a better name for cases like `const x = Q(y)`, reusing `x` instead of generating `_temp1`
            const possibleAssign = path.findParent((p) => p.isVariableDeclarator() && t.isIdentifier(p.node.id)) as NodePath<t.VariableDeclarator> | null;
            id = path.scope.generateUidIdentifier((possibleAssign?.node.id as t.Identifier | undefined)?.name);
            sideEffect = withSource(callee, template(`
              /* ${macroName} */
              let %%id%% = %%argument%%;
            `, parseOptions)({ id, argument }));
          }
        } else {
          throw path.get('arguments.0').buildCodeFrameError(`First argument to ${macroName} should be an identifier`);
        }

        let result: t.Statement[];
        switch (macroName) {
          case 'ReturnIfAbrupt': {
            if (t.isIdentifier(argument)) {
              const binding = path.scope.getBinding(argument.name)!;
              (binding.path.parent as t.VariableDeclaration).kind = 'let';
            }
            result = Macros.ReturnIfAbrupt.template(callee, { value: id });
            break;
          }
          case 'X': {
            if (t.isIdentifier(argument)) {
              const binding = path.scope.getBinding(argument.name)!;
              (binding.path.parent as t.VariableDeclaration).kind = 'let';
            }
            const source = t.stringLiteral(`! ${path.get('arguments.0').getSource()} returned an abrupt completion`);
            const checkYieldStar = t.isYieldExpression(argument, { delegate: true }) ? null : skipDebugger(id as t.Identifier, callee);
            result = Macros.X.template(callee, { value: id, checkYieldStar, source });
            break;
          }
          case 'Throw':
            if (!t.isExpression(argument)) {
              throw path.get('arguments.0').buildCodeFrameError('Argument to Throw should be an expression');
            }
            result = Macros.Throw.template(callee, { value: argument });
            break;
          default:
            ((_: never): never => {
              throw path.buildCodeFrameError(`Internal error: no template found for macro ${_}`);
            })(macroName);
        }
        if (statementPath.parentPath?.isIfStatement() && !statementPath.isBlock()) {
          statementPath.replaceWith(t.blockStatement([
            ...sideEffect!, ...result, statementPath.node as t.Statement,
          ].filter(Boolean)));
        } else {
          if (sideEffect.length) statementPath.insertBefore(sideEffect);
          statementPath.insertBefore(result);
        }
        if (path.parentPath.isExpressionStatement()) {
          removePath(path);
        } else {
          path.replaceWith(id);
        }
      }
    },
    ThrowStatement(path) {
      const arg = path.get('argument');
      const callee = arg.get('callee');
      if (callee.isMemberExpression() && callee.node.object.type === 'Identifier' && callee.node.object.name === 'OutOfRange') {
        path.addComment('leading', ' node:coverage ignore next ', false);

        const { parentPath } = path;
        if (parentPath.isSwitchCase() && parentPath.node.consequent[0] === path.node) {
          parentPath.addComment('leading', ' node:coverage ignore next ', false);
        }
      }
    },
    FunctionDeclaration(path) {
      addSectionFromComments(path);
    },
    VariableDeclaration(path) {
      if (path.get('declarations.0.init').isArrowFunctionExpression() || path.get('declarations.0.init').isFunctionExpression()) {
        addSectionFromComments(path);
      }
    },
    ExportNamedDeclaration(path) {
      if (path.get('declaration').isFunctionDeclaration()) {
        addSectionFromComments(path);
      }
    },
  },
});

function addSectionFromComments(path: NodePath<t.FunctionDeclaration> | NodePath<t.VariableDeclaration> | NodePath<t.ExportNamedDeclaration>) {
  if (path.node.leadingComments) {
    for (const c of path.node.leadingComments) {
      let name: string;
      switch (path.type) {
        case 'FunctionDeclaration':
          name = path.node.id!.name;
          break;
        case 'ExportNamedDeclaration':
          name = (path.node.declaration as t.FunctionDeclaration).id!.name;
          break;
        case 'VariableDeclaration':
          name = (path.node.declarations[0].id as t.Identifier).name;
          break;
        default:
          throw (path as NodePath).buildCodeFrameError('Internal error: Unsupported path to addSectionFromComments');
      }
      const lines = c.value.split('\n');
      for (const line of lines) {
        if (/#sec/.test(line)) {
          const section = line.split(' ').find((l) => l.includes('#sec'))!;
          const url = section.includes('https') ? section : `https://tc39.es/ecma262/${section}`;
          const result = path.insertAfter(withSource(c, template.ast(`${name}.section = '${url}';`)));
          if (path.node.trailingComments) {
            result[result.length - 1].node.trailingComments = path.node.trailingComments;
            path.node.trailingComments = null;
          }
          return;
        }
      }
    }
  }
}

function skipDebugger(value: t.Identifier, callee: Node) {
  return withSource(callee, template.statement(`
    /* node:coverage ignore next */ if (%%value%% && typeof %%value%% === 'object' && 'next' in %%value%%) %%value%% = skipDebugger(%%value%%);
  `, { preserveComments: true })({ value }))[0];
}

function removePath(path: NodePath<t.CallExpression>) {
  try {
    path.remove();
  } catch (e) {
    throw path.get('arguments.0').buildCodeFrameError(`Macros error: ${(e as Error).message}`);
  }
}

function getEnclosingConditionalExpression(path: NodePath) {
  while (path && !path.isStatement()) {
    if (path.isConditionalExpression()) {
      return path;
    }
    path = path.parentPath!;
  }
  return null;
}

/**
 * We cannot transform for the following cases:
 *
 * while (Q(...))
 * switch (Q(...)) { case Q(...): }
 * for (; Q(...);) { }
 *
 * For if (...), we can do this: if (Q(...)), but not this: if (x && Q(...)) {}
 */
function withinNotTransformablePosition(path: NodePath) {
  const paths = [path.node];
  while (path) {
    const parent = path.parentPath;
    if (!parent) return false;
    if (parent.isWhileStatement() || parent.isForStatement()) {
      if (parent.node.test === path.node) return true;
      if (parent.node.body === path.node) return false;
    }
    if (parent.isIfStatement()) {
      if (parent.node.consequent === path.node || parent.node.alternate === path.node) return false;
      if (parent.node.test.type === 'BinaryExpression' && paths.includes(parent.node.test.right)) {
        return true;
      }
    }
    paths.push(parent.node);
    path = parent;
  }
  return false;
}

type NodeWithLocation = Pick<t.Node, 'start' | 'end' | 'loc'>;
/** Attach source map information to map generated nodes (node) to original node (source) */
function withSource(source: NodeWithLocation, node: t.Statement | t.Statement[]): t.Statement[] {
  if (!Array.isArray(node)) {
    node = [node];
  }
  for (const n of node) {
    setSource(source, n);
    traverse(n, {
      noScope: true,
      enter(path) {
        setSource(source, path.node);
      },
    });
  }
  return node;
}

/** Attach source map information to map generated node (n) to original node (source) */
function setSource(source: NodeWithLocation, n: t.Node) {
  if (n.loc) {
    return;
  }
  n.start = source.start;
  n.end = source.end;
  n.loc = source.loc;
  n.leadingComments?.forEach((comment) => {
    comment.start = source.start || undefined;
    comment.end = source.end || undefined;
    comment.loc = source.loc || undefined;
  });
}
