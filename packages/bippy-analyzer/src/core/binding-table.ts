import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceFileResolver } from "./source-file-resolver";
import type {
  AbstractValue,
  Binding,
  BindingKind,
  BindingValue,
  Domain,
  BindingPlace,
} from "./types";
import { dedupeAbstractValues } from "./constraints";
import { PlaceMap, getBindingPlace } from "./utils/place";
import { createBindingValue } from "./symbolic-values";

export interface BindingOptions extends Partial<
  Pick<Binding, "hookKind" | "propName" | "initial" | "inputPlaces" | "lengthLimit" | "domain">
> {}

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
    const position = loc === GeneratedSource ? "generated" : loc.start.index;
    const declarationKey = `${kind}:${name}:${resolver.fileName}:${position}`;
    const existingBinding = this.#bindingsByKey.get(declarationKey);
    if (existingBinding) return existingBinding;
    const binding: Binding = {
      id: this.#bindingsByKey.size,
      name: resolver.getSourceName(loc) ?? name,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: options.domain ?? resolver.getDomain(loc),
      samples: kind === "prop" ? resolver.getSamples(loc, options.propName ?? name) : [],
      initial: options.initial ?? null,
      inputPlaces: options.inputPlaces ?? [],
      lengthLimit: options.lengthLimit ?? null,
    };
    this.#bindingsByKey.set(declarationKey, binding);
    this.#resolversByBinding.set(binding.id, resolver);
    this.placeDomains.set(getBindingPlace(binding), binding.domain);
    return binding;
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
