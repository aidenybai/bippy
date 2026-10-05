import type { Protocol } from 'devtools-protocol';
import { kAsyncContext } from './internal.mts';
import { isArray } from './language.mts';
import {
  ExecutionContext, type ParseNode, Value, NullValue, isECMAScriptFunctionObject, isBuiltinFunctionObject, type FunctionObject, isFunctionObject, JSStringValue, surroundingAgent, DynamicParsedCodeRecord,
  IsError as isErrorObject,
} from '#self';


export class CallSite {
  context: ExecutionContext;

  lastNode: ParseNode | null = null;

  nextNode: ParseNode | null = null;

  lastCallNode: ParseNode.CallExpression | null = null;

  inheritedLastCallNode: ParseNode.CallExpression | null = null;

  constructCall = false;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  clone(context = this.context) {
    const c = new CallSite(context);
    c.lastNode = this.lastNode;
    c.lastCallNode = this.lastCallNode;
    c.inheritedLastCallNode = this.inheritedLastCallNode;
    c.constructCall = this.constructCall;
    return c;
  }

  isTopLevel() {
    return this.context.Function === Value.null;
  }

  isConstructCall() {
    return this.constructCall;
  }

  isAsync() {
    if (!(this.context.Function instanceof NullValue) && isECMAScriptFunctionObject(this.context.Function) && this.context.Function.ECMAScriptCode) {
      const code = this.context.Function.ECMAScriptCode;
      return code.type === 'AsyncBody' || code.type === 'AsyncGeneratorBody';
    }
    return false;
  }

  isNative() {
    return isBuiltinFunctionObject(this.context.Function);
  }

  static getFunctionName(func: FunctionObject) {
    if (isFunctionObject(func)) {
      if (isBuiltinFunctionObject(func)) {
        const name = func.nativeFunction.name;
        if (name !== 'defaultConstructor') {
          return name.replace('Proto_', '#').replace(/(Constructor|_getter|_setter|Getter|Setter)$/, '').replaceAll(/([a-zA-Z])_([a-zA-Z])/g, '$1.$2');
        }
      }
      if (typeof func.InitialName === 'string') {
        return func.InitialName;
      }
      const name = func.properties.get('name');
      if (name && name.Value && name.Value instanceof JSStringValue) {
        return name.Value.stringValue();
      }
    }
    return null;
  }

  getFunctionName(): string | null {
    if (this.context.Function instanceof NullValue) return null;
    return CallSite.getFunctionName(this.context.Function);
  }

  getSpecifier() {
    if (this.context.HostDefined?.scriptId && surroundingAgent.parsedSources.get(this.context.HostDefined.scriptId) instanceof DynamicParsedCodeRecord) {
      return null;
    }
    if (this.context.ScriptOrModule) {
      return this.context.ScriptOrModule.HostDefined?.specifier;
    }
    return null;
  }

  getScriptId() {
    const context = this.context.HostDefined?.scriptId;
    if (context) {
      return context;
    }
    if (this.context.ScriptOrModule) {
      return this.context.ScriptOrModule.HostDefined?.scriptId;
    }
    return undefined;
  }

  setLocation(node: ParseNode) {
    this.lastNode = node;
  }

  setNextLocation(node: ParseNode) {
    this.nextNode = node;
  }

  setCallLocation(node: ParseNode.CallExpression | null) {
    this.lastCallNode = node;
  }

  get lineNumber() {
    if (this.lastNode) {
      return this.lastNode.location.start.line;
    }
    return null;
  }

  get columnNumber() {
    if (this.lastNode) {
      return this.lastNode.location.start.column;
    }
    return null;
  }

  loc() {
    if (this.isNative()) {
      return 'native';
    }
    let out = '';
    const specifier = this.getSpecifier();
    if (specifier) {
      out += specifier;
    } else {
      out += '<anonymous>';
    }
    if (this.lineNumber !== null) {
      out += `:${this.lineNumber}`;
      if (this.columnNumber !== null) {
        out += `:${this.columnNumber}`;
      }
    }
    return out.trim();
  }

  toString() {
    const isAsync = this.isAsync();
    const functionName = this.getFunctionName();
    const isConstructCall = this.isConstructCall();
    const isMethodCall = !isConstructCall && !this.isTopLevel();

    let visualFunctionName;
    if (this.inheritedLastCallNode?.CallExpression.type === 'IdentifierReference') {
      visualFunctionName = this.inheritedLastCallNode.CallExpression.name;
    }
    if (visualFunctionName === functionName) {
      visualFunctionName = undefined;
    }

    let string = isAsync ? 'async ' : '';

    if (isConstructCall) {
      string += 'new ';
    }

    if (isMethodCall || isConstructCall) {
      if (functionName) {
        string += functionName;
      } else {
        string += '<anonymous>';
      }
      if (visualFunctionName) {
        string += ` (as ${visualFunctionName})`;
      }
    } else if (functionName) {
      string += functionName;
      if (visualFunctionName) {
        string += ` (as ${visualFunctionName})`;
      }
    } else {
      return `${string}${this.loc()}`;
    }

    return `${string} (${this.loc()})`;
  }

  toCallFrame(): Protocol.Runtime.CallFrame | undefined {
    const source = this.getScriptId();
    if (source === undefined || source === null) {
      return undefined;
    }
    return {
      columnNumber: (this.columnNumber || 1) - 1,
      lineNumber: (this.lineNumber || 1) - 1,
      functionName: this.getFunctionName() || '<anonymous>',
      scriptId: source,
      url: this.getSpecifier() || '<anonymous>',
    };
  }
}

export class CallFrame {
  columnNumber: number | undefined;

  lineNumber: number | undefined;

  functionName: string | undefined;

  scriptId: string | undefined;

  url: string | undefined;

  toCallFrame(): Protocol.Runtime.CallFrame | undefined {
    if (!this.scriptId) {
      return undefined;
    }
    return {
      columnNumber: (this.columnNumber || 1) - 1,
      lineNumber: (this.lineNumber || 1) - 1,
      functionName: this.functionName || '<anonymous>',
      scriptId: this.scriptId,
      url: this.url || '<anonymous>',
    };
  }
}
export function getHostDefinedErrorDetails(O: Value) {
  let callStack: readonly (CallSite | CallFrame)[] | undefined;
  let message: readonly (string | Value)[] | undefined;
  let stack: string | undefined;
  let stackGetterValue: string | undefined;
  if (isErrorObject(O)) {
    if (isArray(O.HostDefinedStack)) callStack = O.HostDefinedStack;
    if (isArray(O.HostDefinedMessage)) message = O.HostDefinedMessage;
    if (typeof O.HostDefinedFormattedStack === 'string') {
      stack = O.HostDefinedFormattedStack;
      if (typeof O.HostDefinedMessageString === 'string') {
        stackGetterValue = O.HostDefinedMessageString + O.HostDefinedFormattedStack;
      }
    }
  }
  return {
    callStack, message, stack, stackGetterValue,
  };
}
function captureAsyncStack(stack: CallSite[]) {
  let promise = stack[0].context.promiseCapability!.Promise;
  for (let i = 0; i < 10; i += 1) {
    if (promise.PromiseFulfillReactions?.length !== 1) {
      return;
    }
    const [reaction] = promise.PromiseFulfillReactions!;
    if (reaction.Handler && reaction.Handler.Callback[kAsyncContext]) {
      const asyncContext = reaction.Handler.Callback[kAsyncContext];
      stack.push(asyncContext.callSite.clone());
      if ('PromiseState' in asyncContext.promiseCapability!.Promise) {
        promise = asyncContext.promiseCapability!.Promise;
      } else {
        return;
      }
    } else if (reaction.Capability) {
      if ('PromiseState' in reaction.Capability.Promise) {
        promise = reaction.Capability.Promise;
      } else {
        return;
      }
    }
  }
}

export function getCurrentStack(excludeGlobalStack = true) {
  const stack: CallSite[] = [];
  for (let i = surroundingAgent.executionContextStack.length - (excludeGlobalStack ? 2 : 1); i >= 0; i -= 1) {
    const e = surroundingAgent.executionContextStack[i];
    if (e.VariableEnvironment === undefined && e.Function === Value.null) {
      break;
    }
    const clone = e.callSite.clone();
    const parent = stack[stack.length - 1];
    if (parent && !parent.context.poppedForTailCall) {
      parent.inheritedLastCallNode = clone.lastCallNode;
    }
    stack.push(clone);
    if (e.callSite.isAsync()) {
      i -= 1; // skip original execution context which has no useful information.
    }
  }

  if (stack.length > 0 && stack[0].context.promiseCapability) {
    captureAsyncStack(stack);
  }
  return stack;
}

export function captureStack() {
  const stack = getCurrentStack();

  let nativeStack: string | undefined;
  if (surroundingAgent.hostDefinedOptions.errorStackAttachNativeStack && 'stackTraceLimit' in Error) {
    const origStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 12;
    try {
      nativeStack = new Error().stack;
    } finally {
      Error.stackTraceLimit = origStackTraceLimit;
    }
  }

  return {
    stack,
    nativeStack,
  };
}

export function callSiteToErrorStack(stack: readonly CallSite[], nativeStack: string | undefined) {
  let errorString = '';
  stack.forEach((s) => {
    errorString = `${errorString}\n    at ${s.toString()}`;
  });
  if (typeof nativeStack === 'string') {
    errorString = `${errorString}\n    <NATIVE>\n${nativeStack.split('\n').slice(6).join('\n')}`;
  }
  return errorString;
}
