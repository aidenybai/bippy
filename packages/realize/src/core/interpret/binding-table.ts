import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceFileResolver } from "../type-checker/source-file-resolver";
import type {
  AbstractValue,
  Binding,
  BindingKind,
  BindingValue,
  Domain,
  BindingPlace,
} from "../types";
import { dedupeAbstractValues } from "../values/abstract-values";
import { PlaceMap } from "../values/place-map";
import { getBindingPlace } from "../values/get-binding-place";
import { createBindingValue } from "../values/symbolic-values";

export interface BindingOptions extends Partial<
  Pick<
    Binding,
    | "hookKind"
    | "propName"
    | "initial"
    | "inputPlaces"
    | "lengthLimit"
    | "derived"
    | "range"
    | "domain"
    | "alias"
    | "firstRender"
  >
> {
  identityKey?: string;
  scope?: string;
}

export class BindingTable {
  readonly #bindingsByKey = new Map<string, Binding>();
  readonly #bindingsByProp = new Map<string, Binding>();
  readonly #resolversByBinding = new Map<number, SourceFileResolver>();
  readonly placeDomains = new PlaceMap<Domain>();
  readonly unionMemberValues = new PlaceMap<AbstractValue[][]>();

  get bindings(): Binding[] {
    return [...this.#bindingsByKey.values()];
  }

  createBinding(
    resolver: SourceFileResolver,
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: BindingOptions = {},
  ): Binding {
    const position =
      options.identityKey ?? (loc === GeneratedSource ? "generated" : loc.start.index);
    const scope = options.scope ?? "";
    const declarationKey = `${kind}:${name}:${resolver.fileName}:${position}:${scope}`;
    const existingBinding = this.#bindingsByKey.get(declarationKey);
    if (existingBinding) return existingBinding;
    const sourceName = resolver.getSourceName(loc) ?? name;
    const sameNamed = [...this.#bindingsByKey.values()].filter(
      (candidate) => candidate.kind === kind && candidate.name.split("#")[0] === sourceName,
    ).length;
    const binding: Binding = {
      id: this.#bindingsByKey.size,
      name: scope && sameNamed > 0 ? `${sourceName}#${sameNamed + 1}` : sourceName,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: options.domain ?? resolver.getDomain(loc),
      samples: kind === "prop" ? resolver.getSamples(loc, options.propName ?? name) : [],
      initial: options.initial ?? null,
      inputPlaces: options.inputPlaces ?? [],
      lengthLimit: options.lengthLimit ?? null,
      derived: options.derived ?? null,
      range: options.range ?? null,
      alias: options.alias ?? null,
      ...(options.firstRender && { firstRender: options.firstRender }),
    };
    this.#bindingsByKey.set(declarationKey, binding);
    this.#resolversByBinding.set(binding.id, resolver);
    this.placeDomains.set(getBindingPlace(binding), binding.domain);
    return binding;
  }

  forgetInitial(binding: Binding): void {
    binding.initial = null;
  }

  isDeclaredIn(binding: Binding, fileName: string): boolean {
    return this.#resolversByBinding.get(binding.id)?.fileName === fileName;
  }

  getPropBinding(
    resolver: SourceFileResolver,
    propName: string,
    localName: string,
    loc: SourceLocation,
  ): Binding {
    const existingBinding = this.#bindingsByProp.get(propName);
    if (existingBinding) return existingBinding;
    const binding = this.createBinding(resolver, localName, "prop", loc, { propName });
    this.#bindingsByProp.set(propName, binding);
    return binding;
  }

  readField(
    resolver: SourceFileResolver,
    binding: Binding,
    path: string[],
    loc: SourceLocation,
  ): BindingValue {
    const place = getBindingPlace(binding, path);
    if (!this.placeDomains.has(place))
      this.#addFieldDomain(binding, place, resolver.getDomain(loc));
    return createBindingValue(binding, path);
  }

  readFieldOfDomain(binding: Binding, path: string[], domain: Domain): BindingValue {
    const place = getBindingPlace(binding, path);
    if (!this.placeDomains.has(place)) this.#addFieldDomain(binding, place, domain);
    return createBindingValue(binding, path);
  }

  #addFieldDomain(binding: Binding, place: BindingPlace, readDomain: Domain): void {
    const [field] = place.path;
    const unionMemberValues =
      place.path.length === 1 && field !== undefined
        ? this.#resolversByBinding.get(binding.id)?.getUnionMemberValues(binding.loc, field)
        : null;
    if (!unionMemberValues || readDomain.kind !== "Cases") {
      this.placeDomains.set(place, readDomain);
      return;
    }
    this.unionMemberValues.set(place, unionMemberValues);
    this.placeDomains.set(place, {
      ...readDomain,
      cases: dedupeAbstractValues([...readDomain.cases, ...unionMemberValues.flat()]),
    });
  }
}
