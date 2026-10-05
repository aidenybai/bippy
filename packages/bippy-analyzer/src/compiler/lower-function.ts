import type { AssignmentTarget, BlockStatement, Expression, Node, Statement } from "oxc-parser";
import type { FunctionLikeNode } from "../parse/source-types.js";
import type { StaticPrimitive } from "../types.js";
import {
  bindFunction,
  getBinding,
  type FunctionBindings,
  type LexicalBinding,
} from "./bindings.js";
import {
  getRequired,
  UnsupportedControlFlow,
  type ControlFlowGraph,
  type FlowBlock,
  type FlowEdge,
  type FlowInstruction,
  type FlowTerminal,
} from "./ir.js";

interface ControlTarget {
  labels: string[];
  breakTarget: number;
  continueTarget: number | null;
  breakDepth: number;
  continueDepth: number;
  acceptsUnlabelled: boolean;
}

interface FinallyFrame {
  body: BlockStatement | null;
  node: Node;
  handler: number;
  controls: ControlTarget[];
  iterator?: number;
}

interface AssignmentReference {
  node: Node;
  binding?: LexicalBinding;
  operands: number[];
}

class FunctionLowerer {
  readonly graph: ControlFlowGraph = {
    entry: 0,
    blocks: new Map(),
    edges: new Map(),
    variables: new Map(),
  };
  private readonly bindings: FunctionBindings;
  private current: FlowBlock | null;
  private nextVariable: number;
  private nextInstruction = 0;
  private readonly memory: number;
  private handler: number;
  private finalizers: FinallyFrame[] = [];
  private controls: ControlTarget[] = [];
  private depth = 0;

  constructor(private readonly root: FunctionLikeNode) {
    this.bindings = bindFunction(root);
    if (this.bindings.dynamicScope)
      throw new UnsupportedControlFlow(root, "Dynamic scope requires runtime binding resolution");
    for (const binding of this.bindings.owned) this.graph.variables.set(binding.id, binding);
    this.nextVariable = Math.max(-1, ...this.graph.variables.keys()) + 1;
    this.current = this.block();
    this.memory = this.variable("$memory", "effect");
    this.emit("input", [], null, this.memory);
    const uncaught = this.block();
    this.handler = uncaught.id;
    const entry = this.current;
    this.current = uncaught;
    const exception = this.emit("input", [], null);
    this.terminate("throw", exception);
    this.current = entry;
  }

  run = (): ControlFlowGraph => {
    for (const binding of this.bindings.owned) {
      if (binding.storage === "cell") this.emit("input", [], binding.declaration, binding.id);
      else if (binding.kind === "var" && !binding.parameterSource)
        this.emit("constant", [], null, binding.id, { constant: undefined });
      else this.emit("uninitialized", [], null, binding.id);
    }
    for (const parameter of this.root.params) {
      const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
      const input = this.emit("input", [], parameter);
      if (pattern.type === "RestElement") this.pattern(pattern.argument, input);
      else if (pattern.type !== "Identifier" || pattern.name !== "this")
        this.pattern(pattern, input);
    }
    for (const binding of this.bindings.owned) {
      if (binding.parameterSource) this.write(binding, this.read(binding.parameterSource, null));
      if (binding.kind === "self") this.write(binding, this.emit("input", [], binding.declaration));
    }
    const body = this.root.body;
    if (!body) throw new UnsupportedControlFlow(this.root, "Function has no body");
    if (body.type === "BlockStatement") this.statements(body);
    else this.exit("return", this.expression(body));
    if (this.current) this.terminate("return", this.literal(undefined));
    return this.graph;
  };

  private variable = (
    name = "$temporary",
    storage: "temporary" | "effect" = "temporary",
  ): number => {
    const variableId = this.nextVariable++;
    this.graph.variables.set(variableId, { id: variableId, name, storage });
    return variableId;
  };

  private block = (): FlowBlock => {
    if (this.graph.blocks.size >= 4096)
      throw new UnsupportedControlFlow(this.root, "Control-flow block limit exceeded");
    const blockId = this.graph.blocks.size;
    const block: FlowBlock = {
      id: blockId,
      predecessors: [],
      instructions: [],
      terminal: { kind: "unreachable", value: null, edges: [] },
    };
    this.graph.blocks.set(blockId, block);
    return block;
  };

  private emit = (
    kind: FlowInstruction["kind"],
    operands: number[],
    node: Node | null,
    target = this.variable(),
    fields: Pick<FlowInstruction, "operator" | "constant"> = {},
  ): number => {
    if (!this.current) throw new Error("Cannot emit into terminated control flow");
    if (this.nextInstruction >= 30000)
      throw new UnsupportedControlFlow(this.root, "Control-flow instruction limit exceeded");
    this.current.instructions.push({
      id: this.nextInstruction++,
      kind,
      operands,
      target,
      node,
      ...fields,
    });
    return target;
  };

  private literal = (value: StaticPrimitive): number =>
    this.emit("constant", [], null, undefined, { constant: value });

  private edge = (target: number, kind: FlowEdge["kind"]): void => {
    if (!this.current) throw new Error("Cannot connect terminated control flow");
    const edgeId = this.graph.edges.size;
    this.graph.edges.set(edgeId, { id: edgeId, from: this.current.id, to: target, kind });
    this.current.terminal.edges.push(edgeId);
    getRequired(this.graph.blocks, target).predecessors.push(edgeId);
  };

  private terminate = (kind: FlowTerminal["kind"], value: number | null = null): void => {
    if (!this.current) return;
    this.current.terminal = { kind, value, edges: [] };
    this.current = null;
  };

  private jump = (
    target: number,
    kind: FlowEdge["kind"] = "normal",
    value: number | null = null,
  ): void => {
    if (!this.current) return;
    this.current.terminal = { kind: "jump", value, edges: [] };
    this.edge(target, kind);
    this.current = null;
  };

  private branch = (value: number, passing: number, failing: number, nullish = false): void => {
    if (!this.current) return;
    this.current.terminal = { kind: "branch", value, edges: [] };
    this.edge(passing, nullish ? "nullish" : "truthy");
    this.edge(failing, nullish ? "defined" : "falsy");
    this.current = null;
  };

  private mayThrow = (value: number, resume = false): number => {
    if (!this.current) return value;
    const continuation = this.block();
    this.current.terminal = { kind: "invoke", value, edges: [] };
    this.edge(continuation.id, resume ? "resume" : "normal");
    this.edge(this.handler, "throw");
    this.current = continuation;
    return value;
  };

  private opaque = (
    node: Node,
    operands: number[],
    operator: string = node.type,
    throws = true,
  ): number => {
    const value = this.emit("opaque", [this.memory, ...operands], node, undefined, { operator });
    this.emit("effect", [this.memory, value], node, this.memory);
    return throws ? this.mayThrow(value) : value;
  };

  private operation = (
    kind: "unary" | "binary",
    operands: number[],
    node: Node,
    operator: string,
  ): number => {
    const coercive =
      kind === "binary"
        ? operator !== "===" && operator !== "!=="
        : !["!", "typeof", "void"].includes(operator);
    const value = this.emit(
      kind,
      coercive ? [...operands, this.memory] : operands,
      node,
      undefined,
      { operator },
    );
    if (coercive) this.emit("effect", [this.memory, value], node, this.memory);
    return this.mayThrow(value);
  };

  private read = (binding: LexicalBinding, node: Node | null): number => {
    if (binding.owner !== this.root)
      return this.opaque(node ?? binding.declaration, [], "load-external");
    const value =
      binding.storage === "cell"
        ? this.emit("load-cell", [this.memory, binding.id], node)
        : this.emit("read", [binding.id], node);
    return binding.kind === "var" || binding.kind === "function" ? value : this.mayThrow(value);
  };

  private write = (binding: LexicalBinding, value: number): void => {
    if (binding.owner !== this.root) {
      this.opaque(binding.declaration, [value], "store-external");
      return;
    }
    if (binding.storage === "cell")
      this.emit("store-cell", [this.memory, binding.id, value], binding.declaration, this.memory);
    else this.emit("copy", [value], binding.declaration, binding.id);
  };

  private reference = (node: AssignmentTarget): AssignmentReference => {
    if (node.type === "Identifier")
      return {
        node,
        binding: this.bindings.references.get(node) ?? this.bindings.declarations.get(node),
        operands: [],
      };
    if (node.type === "MemberExpression") {
      const object = this.expression(node.object);
      const operands = [object];
      if (node.computed)
        operands.push(this.opaque(node.property, [this.expression(node.property)], "property-key"));
      return { node, operands };
    }
    throw new UnsupportedControlFlow(node, "Unsupported assignment reference");
  };

  private load = (reference: AssignmentReference): number =>
    reference.binding
      ? this.read(reference.binding, null)
      : this.opaque(reference.node, reference.operands, "load-reference");

  private store = (reference: AssignmentReference, value: number): void => {
    if (reference.binding) {
      if (reference.binding.kind === "const" || reference.binding.kind === "self") {
        this.read(reference.binding, null);
        this.opaque(reference.node, [value], "invalid-assignment");
        return;
      }
      if (reference.binding.kind !== "var" && reference.binding.kind !== "function")
        this.read(reference.binding, null);
      this.write(reference.binding, value);
    } else this.opaque(reference.node, [...reference.operands, value], "store-reference");
  };

  private pattern = (pattern: Node, value: number, assignment = false): void => {
    switch (pattern.type) {
      case "Identifier": {
        let binding =
          this.bindings.declarations.get(pattern) ?? this.bindings.references.get(pattern);
        const scope = this.bindings.scopes.get(pattern);
        const visible = scope && getBinding(scope, pattern.name);
        if (visible?.kind === "catch") binding = visible;
        if (assignment) this.store({ node: pattern, binding, operands: [] }, value);
        else if (binding) this.write(binding, value);
        return;
      }
      case "AssignmentPattern": {
        const test = this.emit("binary", [value, this.literal(undefined)], pattern, undefined, {
          operator: "===",
        });
        const defaultBlock = this.block();
        const presentBlock = this.block();
        const join = this.block();
        const selected = this.variable();
        this.branch(test, defaultBlock.id, presentBlock.id);
        this.current = defaultBlock;
        this.emit("copy", [this.expression(pattern.right)], pattern, selected);
        this.jump(join.id);
        this.current = presentBlock;
        this.emit("copy", [value], pattern, selected);
        this.jump(join.id);
        this.current = join;
        this.pattern(pattern.left, selected, assignment);
        return;
      }
      case "ObjectPattern": {
        this.opaque(pattern, [value], "require-object");
        for (const property of pattern.properties) {
          if (property.type === "RestElement")
            this.pattern(
              property.argument,
              this.opaque(property, [value], "object-rest"),
              assignment,
            );
          else {
            const operands = [value];
            if (property.computed && property.key.type !== "PrivateIdentifier")
              operands.push(this.expression(property.key));
            const extracted = this.opaque(property, operands, "destructure-property");
            this.pattern(property.value, extracted, assignment);
          }
        }
        return;
      }
      case "ArrayPattern": {
        const iterator = this.opaque(pattern, [value], "iterator-open");
        for (const element of pattern.elements) {
          const extracted = this.opaque(
            element ?? pattern,
            [iterator],
            element?.type === "RestElement" ? "iterator-rest" : "iterator-next",
          );
          if (element)
            this.pattern(
              element.type === "RestElement" ? element.argument : element,
              extracted,
              assignment,
            );
        }
        this.opaque(pattern, [iterator], "iterator-close");
        return;
      }
      case "MemberExpression":
        this.store(this.reference(pattern), value);
        return;
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
        this.pattern(pattern.expression, value, assignment);
        return;
      default:
        throw new UnsupportedControlFlow(pattern, "Unsupported binding pattern");
    }
  };

  private expression = (node: Expression): number => {
    if (++this.depth > 256)
      throw new UnsupportedControlFlow(node, "Expression nesting limit exceeded");
    try {
      return this.lowerExpression(node);
    } finally {
      this.depth--;
    }
  };

  private lowerExpression = (node: Expression): number => {
    switch (node.type) {
      case "Literal":
        return "regex" in node ? this.opaque(node, [], "regexp", false) : this.literal(node.value);
      case "Identifier": {
        const binding = this.bindings.references.get(node);
        return binding ? this.read(binding, node) : this.opaque(node, [], "load-external");
      }
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
      case "TSInstantiationExpression":
        return this.expression(node.expression);
      case "SequenceExpression": {
        let value = this.literal(undefined);
        for (const expression of node.expressions) value = this.expression(expression);
        return value;
      }
      case "UnaryExpression": {
        if (node.operator === "delete") {
          if (node.argument.type === "MemberExpression")
            return this.opaque(node, this.reference(node.argument).operands, "delete");
          if (node.argument.type === "Identifier") return this.opaque(node, [], "delete-binding");
          this.expression(node.argument);
          return this.literal(true);
        }
        if (
          node.operator === "typeof" &&
          node.argument.type === "Identifier" &&
          !this.bindings.references.has(node.argument)
        )
          return this.opaque(node, [], "typeof-external", false);
        const operand = this.expression(node.argument);
        return this.operation("unary", [operand], node, node.operator);
      }
      case "BinaryExpression": {
        if (node.left.type === "PrivateIdentifier")
          return this.opaque(node, [this.expression(node.right)], "private-in");
        const left = this.expression(node.left);
        const right = this.expression(node.right);
        return this.operation("binary", [left, right], node, node.operator);
      }
      case "LogicalExpression": {
        const left = this.expression(node.left);
        const rightBlock = this.block();
        const leftBlock = this.block();
        const join = this.block();
        const selected = this.variable();
        this.branch(
          left,
          node.operator === "||" ? leftBlock.id : rightBlock.id,
          node.operator === "||" ? rightBlock.id : leftBlock.id,
          node.operator === "??",
        );
        this.current = rightBlock;
        this.emit("copy", [this.expression(node.right)], node, selected);
        this.jump(join.id);
        this.current = leftBlock;
        this.emit("copy", [left], node, selected);
        this.jump(join.id);
        this.current = join;
        return selected;
      }
      case "ConditionalExpression": {
        const test = this.expression(node.test);
        const consequent = this.block();
        const alternate = this.block();
        const join = this.block();
        const selected = this.variable();
        this.branch(test, consequent.id, alternate.id);
        this.current = consequent;
        this.emit("copy", [this.expression(node.consequent)], node, selected);
        this.jump(join.id);
        this.current = alternate;
        this.emit("copy", [this.expression(node.alternate)], node, selected);
        this.jump(join.id);
        this.current = join;
        return selected;
      }
      case "AssignmentExpression": {
        if (node.left.type === "ObjectPattern" || node.left.type === "ArrayPattern") {
          const value = this.expression(node.right);
          this.pattern(node.left, value, true);
          return value;
        }
        const reference = this.reference(node.left);
        if (node.operator === "=") {
          const value = this.expression(node.right);
          this.store(reference, value);
          return value;
        }
        const previous = this.load(reference);
        if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") {
          const update = this.block();
          const unchanged = this.block();
          const join = this.block();
          const result = this.variable();
          this.branch(
            previous,
            node.operator === "||=" ? unchanged.id : update.id,
            node.operator === "||=" ? update.id : unchanged.id,
            node.operator === "??=",
          );
          this.current = update;
          const value = this.expression(node.right);
          this.store(reference, value);
          if (this.current) this.emit("copy", [value], node, result);
          this.jump(join.id);
          this.current = unchanged;
          this.emit("copy", [previous], node, result);
          this.jump(join.id);
          this.current = join;
          return result;
        }
        const value = this.operation(
          "binary",
          [previous, this.expression(node.right)],
          node,
          node.operator.slice(0, -1),
        );
        this.store(reference, value);
        return value;
      }
      case "UpdateExpression": {
        const reference = this.reference(node.argument);
        const previous = this.operation("unary", [this.load(reference)], node, "to-numeric");
        const value = this.emit("unary", [previous], node, undefined, {
          operator: node.operator === "++" ? "increment" : "decrement",
        });
        this.store(reference, value);
        return node.prefix ? value : previous;
      }
      case "MemberExpression":
        return this.load(this.reference(node));
      case "CallExpression":
      case "NewExpression": {
        const operands = [this.expression(node.callee)];
        for (const argument of node.arguments)
          operands.push(
            argument.type === "SpreadElement"
              ? this.opaque(argument, [this.expression(argument.argument)], "spread-arguments")
              : this.expression(argument),
          );
        return this.opaque(node, operands);
      }
      case "ChainExpression": {
        const shortCircuit = this.block();
        const join = this.block();
        const result = this.variable();
        const value = this.chain(node.expression, shortCircuit.id);
        this.emit("copy", [value], node, result);
        this.jump(join.id);
        this.current = shortCircuit;
        this.emit("constant", [], node, result, { constant: undefined });
        this.jump(join.id);
        this.current = join;
        return result;
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return this.opaque(node, [], "create-function", false);
      case "ClassExpression":
      case "ClassDeclaration":
        return this.opaque(node, [], "create-class");
      case "ThisExpression":
      case "Super":
        return this.opaque(node, [], node.type);
      case "MetaProperty":
        return this.opaque(node, [], node.type, false);
      case "ArrayExpression": {
        const operands: number[] = [];
        for (const element of node.elements)
          if (element)
            operands.push(
              element.type === "SpreadElement"
                ? this.opaque(element, [this.expression(element.argument)], "spread-array")
                : this.expression(element),
            );
        return this.opaque(node, operands, "create-array", false);
      }
      case "ObjectExpression": {
        const operands: number[] = [];
        for (const property of node.properties) {
          if (property.type === "SpreadElement")
            operands.push(
              this.opaque(property, [this.expression(property.argument)], "spread-object"),
            );
          else {
            if (property.computed && property.key.type !== "PrivateIdentifier")
              operands.push(
                this.opaque(property.key, [this.expression(property.key)], "property-key"),
              );
            operands.push(this.expression(property.value));
          }
        }
        return this.opaque(node, operands, "create-object", false);
      }
      case "TemplateLiteral": {
        const operands: number[] = [];
        for (const expression of node.expressions)
          operands.push(this.opaque(expression, [this.expression(expression)], "to-string"));
        return this.opaque(node, operands, "template", false);
      }
      case "TaggedTemplateExpression":
        return this.opaque(
          node,
          [this.expression(node.tag), ...node.quasi.expressions.map(this.expression)],
          "tagged-template",
        );
      case "AwaitExpression":
        return this.mayThrow(
          this.opaque(node, [this.expression(node.argument)], "await", false),
          true,
        );
      case "YieldExpression": {
        const value = node.argument ? this.expression(node.argument) : this.literal(undefined);
        const result = this.opaque(
          node,
          [value],
          node.delegate ? "yield-delegate" : "yield",
          false,
        );
        const resume = this.block();
        const returned = this.block();
        if (!this.current) return result;
        this.current.terminal = { kind: "invoke", value: result, edges: [] };
        this.edge(resume.id, "resume");
        this.edge(this.handler, "throw");
        this.edge(returned.id, "return");
        this.current = returned;
        this.exit("return", this.emit("input", [], node));
        this.current = resume;
        return result;
      }
      case "JSXElement": {
        const operands = [
          this.opaque(node.openingElement, [], "jsx-factory"),
          this.jsxTag(node.openingElement.name),
        ];
        for (const attribute of node.openingElement.attributes) {
          if (attribute.type === "JSXSpreadAttribute")
            operands.push(
              this.opaque(attribute, [this.expression(attribute.argument)], "spread-props"),
            );
          else if (attribute.value?.type === "JSXExpressionContainer") {
            if (attribute.value.expression.type !== "JSXEmptyExpression")
              operands.push(this.expression(attribute.value.expression));
          } else if (
            attribute.value?.type === "JSXElement" ||
            attribute.value?.type === "JSXFragment"
          )
            operands.push(this.expression(attribute.value));
        }
        for (const child of node.children) {
          if (child.type === "JSXElement" || child.type === "JSXFragment")
            operands.push(this.expression(child));
          else if (
            child.type === "JSXExpressionContainer" &&
            child.expression.type !== "JSXEmptyExpression"
          )
            operands.push(this.expression(child.expression));
          else if (child.type === "JSXSpreadChild")
            operands.push(this.expression(child.expression));
        }
        return this.opaque(node, operands, "create-element");
      }
      case "JSXFragment": {
        const operands = [
          this.opaque(node, [], "jsx-factory"),
          this.opaque(node, [], "jsx-fragment-type"),
        ];
        for (const child of node.children) {
          if (child.type === "JSXElement" || child.type === "JSXFragment")
            operands.push(this.expression(child));
          else if (
            child.type === "JSXExpressionContainer" &&
            child.expression.type !== "JSXEmptyExpression"
          )
            operands.push(this.expression(child.expression));
          else if (child.type === "JSXSpreadChild")
            operands.push(this.expression(child.expression));
        }
        return this.opaque(node, operands, "create-fragment");
      }
      default:
        throw new UnsupportedControlFlow(node);
    }
  };

  private chain = (node: Expression, shortCircuit: number): number => {
    if (node.type === "MemberExpression") {
      const object = this.chain(node.object, shortCircuit);
      if (node.optional) {
        const present = this.block();
        this.branch(object, shortCircuit, present.id, true);
        this.current = present;
      }
      const operands = [object];
      if (node.computed)
        operands.push(this.opaque(node.property, [this.expression(node.property)], "property-key"));
      return this.opaque(node, operands, "load-property");
    }
    if (node.type === "CallExpression") {
      const callee = this.chain(node.callee, shortCircuit);
      if (node.optional) {
        const present = this.block();
        this.branch(callee, shortCircuit, present.id, true);
        this.current = present;
      }
      const operands = [callee];
      for (const argument of node.arguments)
        operands.push(
          argument.type === "SpreadElement"
            ? this.opaque(argument, [this.expression(argument.argument)], "spread-arguments")
            : this.expression(argument),
        );
      return this.opaque(node, operands, "call");
    }
    return this.expression(node);
  };

  private jsxTag = (node: Node, member = false): number => {
    if (node.type === "JSXIdentifier") {
      if (node.name === "this") return this.opaque(node, [], "ThisExpression");
      if (!member && /^[a-z]/.test(node.name)) return this.literal(node.name);
      const binding = this.bindings.references.get(node);
      return binding ? this.read(binding, node) : this.opaque(node, [], "load-external");
    }
    if (node.type === "JSXMemberExpression")
      return this.opaque(node, [this.jsxTag(node.object, true)], "load-jsx-member");
    if (node.type === "JSXNamespacedName")
      return this.literal(`${node.namespace.name}:${node.name.name}`);
    throw new UnsupportedControlFlow(node, "Unsupported JSX tag");
  };

  private enterScope = (node: Node): void => {
    const scope = this.bindings.scopes.get(node);
    if (!scope) return;
    for (const binding of scope.bindings.values()) {
      if (
        binding.owner !== this.root ||
        binding.kind === "var" ||
        binding.kind === "parameter" ||
        binding.kind === "catch" ||
        binding.kind === "self"
      )
        continue;
      const value = this.emit(
        binding.kind === "function" ? "input" : "uninitialized",
        [],
        binding.declaration,
      );
      this.write(binding, value);
    }
  };

  private statements = (body: BlockStatement): void => {
    this.enterScope(body);
    for (const statement of body.body) {
      if (!this.current) break;
      this.statement(statement);
    }
  };

  private exit = (
    kind: "return" | "jump",
    value: number | null,
    target?: number,
    depth = 0,
  ): void => {
    const finalizers = this.finalizers;
    const handler = this.handler;
    const controls = this.controls;
    for (let index = finalizers.length - 1; index >= depth && this.current; index--) {
      const frame = finalizers[index];
      this.finalizers = finalizers.slice(0, index);
      this.handler = frame.handler;
      this.controls = frame.controls;
      if (frame.body) this.statements(frame.body);
      else
        this.opaque(
          frame.node,
          frame.iterator === undefined ? [] : [frame.iterator],
          "iterator-close",
        );
    }
    if (this.current) {
      if (kind === "return") this.terminate("return", value);
      else if (target !== undefined) this.jump(target);
    }
    this.finalizers = finalizers;
    this.handler = handler;
    this.controls = controls;
  };

  private statement = (node: Statement, labels: string[] = []): void => {
    if (!this.current) return;
    switch (node.type) {
      case "BlockStatement":
        this.statements(node);
        return;
      case "EmptyStatement":
      case "DebuggerStatement":
      case "FunctionDeclaration":
      case "TSDeclareFunction":
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
        return;
      case "ExpressionStatement":
        this.expression(node.expression);
        return;
      case "VariableDeclaration":
        if (node.kind !== "var" && node.kind !== "let" && node.kind !== "const")
          throw new UnsupportedControlFlow(node, "Resource declarations require disposal lowering");
        for (const declaration of node.declarations) {
          if (!this.current) break;
          if (declaration.init) this.pattern(declaration.id, this.expression(declaration.init));
          else if (node.kind !== "var") this.pattern(declaration.id, this.literal(undefined));
        }
        return;
      case "ReturnStatement":
        this.exit(
          "return",
          node.argument ? this.expression(node.argument) : this.literal(undefined),
        );
        return;
      case "ThrowStatement": {
        const value = this.expression(node.argument);
        if (this.current) {
          this.current.terminal = { kind: "jump", value, edges: [] };
          this.edge(this.handler, "throw");
          this.current = null;
        }
        return;
      }
      case "IfStatement": {
        const test = this.expression(node.test);
        const consequent = this.block();
        const alternate = this.block();
        const join = this.block();
        this.branch(test, consequent.id, alternate.id);
        this.current = consequent;
        this.statement(node.consequent);
        this.jump(join.id);
        this.current = alternate;
        if (node.alternate) this.statement(node.alternate);
        this.jump(join.id);
        this.current = join.predecessors.length ? join : null;
        return;
      }
      case "LabeledStatement": {
        const names = [...labels, node.label.name];
        if (
          [
            "ForStatement",
            "ForInStatement",
            "ForOfStatement",
            "WhileStatement",
            "DoWhileStatement",
            "SwitchStatement",
            "LabeledStatement",
          ].includes(node.body.type)
        )
          this.statement(node.body, names);
        else {
          const after = this.block();
          this.controls.push({
            labels: names,
            breakTarget: after.id,
            continueTarget: null,
            breakDepth: this.finalizers.length,
            continueDepth: this.finalizers.length,
            acceptsUnlabelled: false,
          });
          this.statement(node.body);
          this.jump(after.id);
          this.controls.pop();
          this.current = after;
        }
        return;
      }
      case "BreakStatement":
      case "ContinueStatement": {
        const isContinue = node.type === "ContinueStatement";
        const label = node.label?.name;
        const target = [...this.controls]
          .reverse()
          .find(
            (control) =>
              (label ? control.labels.includes(label) : control.acceptsUnlabelled) &&
              (!isContinue || control.continueTarget !== null),
          );
        if (!target) throw new UnsupportedControlFlow(node, "Unresolved control-flow label");
        this.exit(
          "jump",
          null,
          isContinue ? target.continueTarget! : target.breakTarget,
          isContinue ? target.continueDepth : target.breakDepth,
        );
        return;
      }
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement": {
        if (node.type === "ForStatement") this.enterScope(node);
        if (node.type === "ForStatement" && node.init) {
          if (node.init.type === "VariableDeclaration") this.statement(node.init);
          else this.expression(node.init);
        }
        const header = this.block();
        const body = this.block();
        const update = this.block();
        const after = this.block();
        this.jump(node.type === "DoWhileStatement" ? body.id : header.id);
        this.current = header;
        this.branch(node.test ? this.expression(node.test) : this.literal(true), body.id, after.id);
        this.controls.push({
          labels,
          breakTarget: after.id,
          continueTarget: node.type === "ForStatement" ? update.id : header.id,
          breakDepth: this.finalizers.length,
          continueDepth: this.finalizers.length,
          acceptsUnlabelled: true,
        });
        this.current = body;
        this.statement(node.body);
        this.jump(node.type === "ForStatement" ? update.id : header.id);
        this.current = update;
        if (node.type === "ForStatement" && node.update) this.expression(node.update);
        this.jump(header.id);
        this.controls.pop();
        this.current = after;
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        this.enterScope(node);
        const iterator = this.opaque(
          node.right,
          [this.expression(node.right)],
          node.type === "ForOfStatement" ? "iterator-open" : "enumerate",
        );
        const header = this.block();
        const body = this.block();
        const after = this.block();
        this.jump(header.id);
        this.current = header;
        let next = this.opaque(node, [iterator], "iterator-next");
        if (node.type === "ForOfStatement" && node.await) next = this.mayThrow(next, true);
        this.branch(this.opaque(node, [next], "iterator-has-value"), body.id, after.id);
        const depth = this.finalizers.length;
        if (node.type === "ForOfStatement")
          this.finalizers.push({
            body: null,
            node,
            iterator,
            handler: this.handler,
            controls: [...this.controls],
          });
        this.controls.push({
          labels,
          breakTarget: after.id,
          continueTarget: header.id,
          breakDepth: depth,
          continueDepth: this.finalizers.length,
          acceptsUnlabelled: true,
        });
        this.current = body;
        const value = this.opaque(node, [next], "iterator-value");
        if (node.left.type === "VariableDeclaration")
          this.pattern(node.left.declarations[0].id, value);
        else if (node.left.type === "ObjectPattern" || node.left.type === "ArrayPattern")
          this.pattern(node.left, value, true);
        else this.store(this.reference(node.left), value);
        this.statement(node.body);
        this.jump(header.id);
        this.controls.pop();
        this.finalizers.length = depth;
        this.current = after;
        return;
      }
      case "SwitchStatement": {
        const discriminant = this.expression(node.discriminant);
        this.enterScope(node);
        const entries = node.cases.map(() => this.block());
        const after = this.block();
        let defaultTarget = after.id;
        for (const [index, switchCase] of node.cases.entries()) {
          if (!switchCase.test) {
            defaultTarget = entries[index].id;
            continue;
          }
          const comparison = this.emit(
            "binary",
            [discriminant, this.expression(switchCase.test)],
            switchCase.test,
            undefined,
            { operator: "===" },
          );
          const next = this.block();
          this.branch(comparison, entries[index].id, next.id);
          this.current = next;
        }
        this.jump(defaultTarget);
        this.controls.push({
          labels,
          breakTarget: after.id,
          continueTarget: null,
          breakDepth: this.finalizers.length,
          continueDepth: this.finalizers.length,
          acceptsUnlabelled: true,
        });
        for (const [index, switchCase] of node.cases.entries()) {
          this.current = entries[index];
          for (const statement of switchCase.consequent) {
            if (!this.current) break;
            this.statement(statement);
          }
          this.jump(entries[index + 1]?.id ?? after.id);
        }
        this.controls.pop();
        this.current = after;
        return;
      }
      case "TryStatement": {
        const outerHandler = this.handler;
        const outerFinalizers = [...this.finalizers];
        const after = this.block();
        const caught = node.handler ? this.block() : null;
        const exceptionalFinally = node.finalizer ? this.block() : null;
        const frame: FinallyFrame | null = node.finalizer
          ? { body: node.finalizer, node, handler: outerHandler, controls: [...this.controls] }
          : null;
        if (frame) this.finalizers.push(frame);
        this.handler = caught?.id ?? exceptionalFinally?.id ?? outerHandler;
        this.statements(node.block);
        this.exit("jump", null, after.id, outerFinalizers.length);
        if (caught && node.handler) {
          this.current = caught;
          this.handler = exceptionalFinally?.id ?? outerHandler;
          if (node.handler.param)
            this.pattern(node.handler.param, this.emit("input", [], node.handler));
          this.statements(node.handler.body);
          this.exit("jump", null, after.id, outerFinalizers.length);
        }
        this.finalizers = outerFinalizers;
        this.handler = outerHandler;
        if (exceptionalFinally && node.finalizer) {
          this.current = exceptionalFinally;
          const pendingException = this.emit("input", [], null);
          this.statements(node.finalizer);
          this.jump(outerHandler, "throw", pendingException);
        }
        this.current = after.predecessors.length ? after : null;
        return;
      }
      case "ClassDeclaration": {
        const value = this.opaque(node, [], "create-class");
        const scope = this.bindings.scopes.get(node)?.parent;
        const binding = node.id && scope ? getBinding(scope, node.id.name) : undefined;
        if (binding) this.write(binding, value);
        return;
      }
      default:
        throw new UnsupportedControlFlow(node);
    }
  };
}

export const lowerFunction = (node: FunctionLikeNode): ControlFlowGraph =>
  new FunctionLowerer(node).run();
