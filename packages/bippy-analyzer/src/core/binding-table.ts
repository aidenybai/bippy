import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { DomainResolver } from "./infer-domains";
import type { AbstractValue, Binding, BindingKind, BindingValue, Domain } from "./types";
import { PlaceMap, getBindingPlace } from "./utils/place";

export interface BindingOptions extends Partial<
  Pick<Binding, "hookKind" | "propName" | "initial" | "inputs" | "lengthSource" | "domain">
> {}

/** One binding per declaration, so evaluating it again reads the same binding. */
export class BindingTable {
  readonly #bindings = new Map<string, Binding>();
  readonly #propBindings = new Map<string, Binding>();
  readonly #resolvers = new Map<number, DomainResolver>();
  readonly placeDomains = new PlaceMap<Domain>();
  readonly memberCases = new PlaceMap<AbstractValue[][]>();

  get bindings(): Binding[] {
    return [...this.#bindings.values()];
  }

  create(
    resolver: DomainResolver,
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: BindingOptions = {},
  ): Binding {
    const position = loc === GeneratedSource ? "generated" : loc.start.index;
    const key = `${kind}:${name}:${resolver.fileName}:${position}`;
    const existing = this.#bindings.get(key);
    if (existing) return existing;
    const binding: Binding = {
      id: this.#bindings.size,
      name: resolver.getSourceName(loc) ?? name,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: options.domain ?? resolver.getDomain(loc),
      samples: kind === "prop" ? resolver.getSamples(loc, options.propName ?? name) : [],
      initial: options.initial ?? null,
      inputs: options.inputs ?? [],
      lengthSource: options.lengthSource ?? null,
    };
    this.#bindings.set(key, binding);
    this.#resolvers.set(binding.id, resolver);
    this.placeDomains.set(getBindingPlace(binding), binding.domain);
    return binding;
  }

  getProp(
    resolver: DomainResolver,
    propName: string,
    localName: string,
    loc: SourceLocation,
  ): Binding {
    const existing = this.#propBindings.get(propName);
    if (existing) return existing;
    const binding = this.create(resolver, localName, "prop", loc, { propName });
    this.#propBindings.set(propName, binding);
    return binding;
  }

  readField(
    resolver: DomainResolver,
    binding: Binding,
    path: string[],
    loc: SourceLocation,
  ): BindingValue {
    const place = getBindingPlace(binding, path);
    if (!this.placeDomains.has(place)) {
      this.placeDomains.set(place, resolver.getDomain(loc));
      const [field] = path;
      const memberCases =
        path.length === 1 && field !== undefined
          ? this.#resolvers.get(binding.id)?.getMemberCases(binding.loc, field)
          : null;
      if (memberCases) this.memberCases.set(place, memberCases);
    }
    return { kind: "Binding", binding, path };
  }
}
