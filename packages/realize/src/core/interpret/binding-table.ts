import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceFileResolver } from "../type-checker/source-file-resolver";
import type { Binding, BindingKind, BindingValue, Domain, BindingPlace } from "../types";
import { dedupeAbstractValues } from "../values/abstract-values";
import { isEnumerated } from "../type-checker/domains";
import { PlaceMap } from "../values/place-map";
import { getBindingPlace } from "../values/get-binding-place";
import { createBindingValue } from "../values/symbolic-values";

export interface BindingOptions extends Partial<
  Pick<Binding, "hookKind" | "propName" | "initial" | "inputPlaces" | "isDerived" | "domain">
> {
  identityKey?: string;
  scope?: string;
}

const getNameKey = (kind: BindingKind, name: string): string => `${kind}:${name}`;

export class BindingTable {
  readonly bindings: Binding[] = [];
  readonly #bindingsByKey = new Map<string, Binding>();
  readonly #bindingsByProp = new Map<string, Binding>();
  readonly #sameNamedCounts = new Map<string, number>();
  readonly #resolvers: SourceFileResolver[] = [];
  readonly placeDomains = new PlaceMap<Domain>();

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
    const sameNamed = this.#sameNamedCounts.get(getNameKey(kind, sourceName)) ?? 0;
    const binding: Binding = {
      id: this.bindings.length,
      name: scope && sameNamed > 0 ? `${sourceName}#${sameNamed + 1}` : sourceName,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: options.domain ?? resolver.getDomain(loc),
      samples: kind === "prop" ? resolver.getSamples(loc, options.propName ?? name) : [],
      initial: options.initial ?? null,
      inputPlaces: options.inputPlaces ?? [],
      isDerived: options.isDerived ?? false,
    };
    const nameKey = getNameKey(kind, binding.name.split("#")[0] ?? "");
    this.#sameNamedCounts.set(nameKey, (this.#sameNamedCounts.get(nameKey) ?? 0) + 1);
    this.#bindingsByKey.set(declarationKey, binding);
    this.bindings.push(binding);
    this.#resolvers.push(resolver);
    this.placeDomains.set(getBindingPlace(binding), binding.domain);
    return binding;
  }

  forgetInitial(binding: Binding): void {
    binding.initial = null;
  }

  isDeclaredIn(binding: Binding, fileName: string): boolean {
    return this.#resolvers[binding.id].fileName === fileName;
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
        ? this.#resolvers[binding.id].getUnionMemberValues(binding.loc, field)
        : null;
    if (!unionMemberValues || readDomain.kind === "Unknown") {
      this.placeDomains.set(place, readDomain);
      return;
    }
    const readCases = isEnumerated(readDomain) ? readDomain.cases : [];
    this.placeDomains.set(place, {
      kind: "Cases",
      cases: dedupeAbstractValues([...readCases, ...unionMemberValues.flat()]),
      origin: readDomain.origin,
    });
  }
}
