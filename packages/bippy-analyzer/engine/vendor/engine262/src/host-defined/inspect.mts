import {
  JSStringValue, ObjectValue, Value, wellKnownSymbols, BooleanValue, NumberValue, BigIntValue, SymbolValue,
} from '../value.mts';
import { Completion, X } from '../completion.mts';
import { isRegExpObject } from '../intrinsics/RegExp.mts';
import type { DateObject } from '../intrinsics/Date.mts';
import type { BooleanObject } from '../intrinsics/Boolean.mts';
import type { NumberObject } from '../intrinsics/Number.mts';
import type { BigIntObject } from '../intrinsics/BigInt.mts';
import type { StringObject } from '../intrinsics/String.mts';
import type { SymbolObject } from '../intrinsics/Symbol.mts';
import { isTypedArrayObject } from '../intrinsics/TypedArray.mts';
import { isShadowRealmObject } from '../intrinsics/ShadowRealm.mts';
import { IsDataDescriptor, surroundingAgent } from '#self';
import {
  Call, IsArray, Get, LengthOfArrayLike,
  EscapeRegExpPattern, R, type BuiltinFunctionObject,

  Realm,
  type Descriptor, type ValueCompletion, type PromiseObject, CyclicModuleRecord,
} from '#self';

const bareKeyRe = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

function getObjectTag(value: ObjectValue, wrap = false): string {
  let s = '';
  try {
    s = (X(Get(value, wellKnownSymbols.toStringTag)) as JSStringValue).stringValue();
  } catch { }
  try {
    const c = X(Get(value, 'constructor'));
    s = (X(Get(c as ObjectValue, 'name')) as JSStringValue).stringValue();
  } catch { }
  if (s) {
    if (wrap) {
      return `[${s}] `;
    }
    return s;
  }
  return '';
}

const compactObject = (realm: Realm, value: ObjectValue) => {
  try {
    const toString = X(Get(value, 'toString')) as BuiltinFunctionObject;
    const objectToString = realm.Intrinsics['%Object.prototype.toString%'];
    if (toString.nativeFunction === objectToString.nativeFunction) {
      return (X(Call(toString, value)) as JSStringValue).stringValue();
    } else {
      const tag = getObjectTag(value, false) || 'Unknown';
      const ctor = X(Get(value, 'constructor'));
      if (ctor instanceof ObjectValue) {
        const ctorName = (X(Get(ctor, 'name')) as JSStringValue).stringValue();
        if (ctorName !== '') {
          return `#<${ctorName}>`;
        }
        return `[object ${tag}]`;
      }
      return `[object ${tag}]`;
    }
  } catch (e) {
    return '[object Unknown]';
  }
};

interface InspectContext {
  realm: Realm;
  indent: number;
  inspected: Value[];
  compact: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Inspector = (value: any, context: InspectContext, inner: (v: Value) => string) => string;

const INSPECTORS = {
  Null: () => 'null',
  Undefined: () => 'undefined',
  Boolean: (v: BooleanValue) => v.booleanValue().toString(),
  Number: (v: NumberValue) => {
    const n = R(v);
    if (n === 0 && Object.is(n, -0)) {
      return '-0';
    }
    return n.toString();
  },
  BigInt: (v: BigIntValue) => `${R(v)}n`,
  String: (v: JSStringValue) => {
    const s = JSON.stringify(v.stringValue()).slice(1, -1);
    return `'${s}'`;
  },
  Symbol: (v: SymbolValue) => `Symbol(${v.Description || ''})`,
  Object: (v: ObjectValue, ctx, i) => {
    if (ctx.inspected.includes(v)) {
      return '[Circular]';
    }
    if ('PromiseState' in v) {
      ctx.indent += 1;
      const result = v.PromiseState === 'pending' ? 'undefined' : i((v as PromiseObject).PromiseResult!);
      ctx.indent -= 1;
      return `Promise {
  [[PromiseState]]: ${v.PromiseState}
  [[PromiseResult]]: ${result}
}`;
    }
    if (
      'Module' in v
      && v.Module instanceof CyclicModuleRecord
      && v.Module.Status === 'linked'
      && v.Module.DeferredNamespace === v
    ) {
      // Do not read the namespace to avoid triggering the module evaluation.
      return 'Deferred Module { ... }';
    }

    if ('Call' in v) {
      const name = v.properties.get('name');
      if (name && (name.Value! as JSStringValue).stringValue() !== '') {
        return `[Function: ${(name.Value as JSStringValue).stringValue()}]`;
      }
      return '[Function]';
    }

    if ('ErrorData' in v) {
      let e = X(Get(v, 'stack'));
      if (!(e as JSStringValue).stringValue) {
        const toString = X(Get(v, 'toString'));
        e = X(Call(toString, v));
      }
      return (e as JSStringValue).stringValue();
    }

    if (isRegExpObject(v)) {
      const P = EscapeRegExpPattern(v.OriginalSource, v.OriginalFlags);
      const F = v.OriginalFlags;
      return `/${P}/${F}`;
    }

    if ('DateValue' in v) {
      const d = new Date((v as DateObject).DateValue);
      if (Number.isNaN(d.getTime())) {
        return '[Date Invalid]';
      }
      return `[Date ${d.toISOString()}]`;
    }

    if ('BooleanData' in v) {
      return `[Boolean ${(v as BooleanObject).BooleanData}]`;
    }
    if ('NumberData' in v) {
      return `[Number ${(v as NumberObject).NumberData}]`;
    }
    if ('BigIntData' in v) {
      return `[BigInt ${(v as BigIntObject).BigIntData}]`;
    }
    if ('StringData' in v) {
      return `[String ${(v as StringObject).StringData}]`;
    }
    if ('SymbolData' in v) {
      return `[Symbol ${(v as SymbolObject).SymbolData}]`;
    }
    if (isShadowRealmObject(v)) {
      return '[ShadowRealm]';
    }

    ctx.indent += 1;
    ctx.inspected.push(v);

    try {
      const isArray = IsArray(v);
      const isTypedArray = isTypedArrayObject(v);
      if (isArray || isTypedArray) {
        const length = X(LengthOfArrayLike(v));
        let holes = 0;
        const flushHoles = () => {
          if (holes > 0) {
            out.push(`<${holes} empty items>`);
            holes = 0;
          }
        };
        const out = [];
        for (let j = 0; j < length; j += 1) {
          const elem = X(v.GetOwnProperty(Value(j.toString())));
          if (!elem) {
            holes += 1;
          } else {
            flushHoles();
            if (IsDataDescriptor(elem)) {
              out.push(i(elem.Value));
            } else {
              out.push('<accessor>');
            }
          }
        }
        flushHoles();
        return `${isTypedArray ? `${v.TypedArrayName} ` : ''}[${out.join(', ')}]`;
      }

      const keys = X(v.OwnPropertyKeys());
      const cache = [];
      for (const key of keys) {
        const C = X(v.GetOwnProperty(key)) as Descriptor;
        if (C.Enumerable) {
          cache.push([
            key instanceof JSStringValue && bareKeyRe.test(key.stringValue()) ? key.stringValue() : i(key),
            C.Value ? i(C.Value) : '<accessor>',
          ]);
        }
      }

      const tag = getObjectTag(v);
      let out = tag && tag !== 'Object' ? `${tag} {` : '{';
      if (cache.length > 5) {
        cache.forEach((c) => {
          out = `${out}\n${'  '.repeat(ctx.indent)}${c[0]}: ${c[1]},`;
        });
        return `${out}\n${'  '.repeat(ctx.indent - 1)}}`;
      } else {
        const oc = ctx.compact;
        ctx.compact = true;
        cache.forEach((c, index) => {
          out = `${out}${index === 0 ? '' : ','} ${c[0]}: ${c[1]}`;
        });
        ctx.compact = oc;
        return `${out} }`;
      }
    } catch {
      return compactObject(ctx.realm, v);
    } finally {
      ctx.indent -= 1;
      ctx.inspected.pop();
    }
  },
} satisfies Partial<Record<Value['type'], Inspector>>;

// TODO: add an option to inspect so it can return string with color.
export function inspect(value: Value | ValueCompletion): string {
  const context: InspectContext = {
    realm: surroundingAgent.currentRealmRecord,
    indent: 0,
    inspected: [],
    compact: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (v: Value) => (INSPECTORS[v.type] as any)(v, context, inner);
  if (value instanceof Completion) {
    value = value.Value;
  }
  return inner(value);
}
