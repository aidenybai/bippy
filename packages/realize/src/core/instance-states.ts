import { enumerateStates } from "./enumerate-states";
import { formatAbstractValue } from "./format";
import type { Binding, ComponentAnalysis, ComponentLink, Domain, StateReport } from "./types";
import { getBindingPlace } from "./utils/get-binding-place";
import type { PlaceMap } from "./utils/place-map";

const getBranchedPropNames = (child: ComponentAnalysis, report: StateReport): Set<string> => {
  const branchedIds = new Set(report.regions.flatMap((region) => region.bindingIds));
  return new Set(
    child.bindings.flatMap((binding) =>
      binding.kind === "prop" &&
      binding.propName !== null &&
      (branchedIds.has(binding.id) || binding.domain.kind === "Unknown")
        ? [binding.propName]
        : [],
    ),
  );
};

const getLinkedDomains = (
  child: ComponentAnalysis,
  link: ComponentLink,
  report: StateReport,
): Map<string, Domain> => {
  const branched = getBranchedPropNames(child, report);
  return new Map(
    link.props.flatMap((prop): Array<[string, Domain]> =>
      prop.domain.kind === "Cases" && branched.has(prop.name) ? [[prop.name, prop.domain]] : [],
    ),
  );
};

export const getInstanceKey = (
  child: ComponentAnalysis,
  link: ComponentLink,
  report: StateReport,
): string | null => {
  const domains = getLinkedDomains(child, link, report);
  if (!link.isComplete || domains.size === 0) return null;
  const entries = [...domains].map(
    ([name, domain]) =>
      `${name}=${domain.kind === "Cases" ? domain.cases.map(formatAbstractValue).join("|") : domain.kind}`,
  );
  return `${link.child}\n${entries.sort().join("\n")}`;
};

const overrideNamedProp = (
  binding: Binding,
  domains: Map<string, Domain>,
  placeDomains: PlaceMap<Domain>,
): Binding | null => {
  const domain = binding.propName === null ? undefined : domains.get(binding.propName);
  if (!domain) return null;
  placeDomains.set(getBindingPlace(binding), domain);
  return { ...binding, domain };
};

const overridePropFields = (
  binding: Binding,
  domains: Map<string, Domain>,
  placeDomains: PlaceMap<Domain>,
): boolean => {
  let isOverridden = false;
  for (const [name, domain] of domains) {
    const place = getBindingPlace(binding, [name]);
    if (!placeDomains.has(place)) continue;
    placeDomains.set(place, domain);
    isOverridden = true;
  }
  return isOverridden;
};

const createInstanceAnalysis = (
  child: ComponentAnalysis,
  link: ComponentLink,
  report: StateReport,
): ComponentAnalysis | null => {
  const domains = getLinkedDomains(child, link, report);
  if (!link.isComplete || domains.size === 0) return null;
  const placeDomains = child.placeDomains.clone();
  const overriddenIds = new Set<number>();
  const bindings = child.bindings.map((binding) => {
    if (binding.kind !== "prop") return binding;
    if (binding.propName === null) {
      if (overridePropFields(binding, domains, placeDomains)) overriddenIds.add(binding.id);
      return binding;
    }
    const overridden = overrideNamedProp(binding, domains, placeDomains);
    if (overridden) overriddenIds.add(binding.id);
    return overridden ?? binding;
  });
  if (overriddenIds.size === 0) return null;
  const overriddenLocs = new Set(
    bindings.filter((binding) => overriddenIds.has(binding.id)).map((binding) => binding.loc),
  );
  return {
    ...child,
    bindings,
    placeDomains,
    bailouts: child.bailouts.filter(
      (bailout) => !(bailout.reason === "untyped-prop" && overriddenLocs.has(bailout.loc)),
    ),
  };
};

export const enumerateInstance = (
  child: ComponentAnalysis,
  link: ComponentLink,
  report: StateReport,
): StateReport | null => {
  const instance = createInstanceAnalysis(child, link, report);
  return instance ? enumerateStates(instance) : null;
};
