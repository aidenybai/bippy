import { useState } from "react";

// i18next's `getUsedParamsDetails`: a copy of the caller's options (whose
// spread the analysis cannot see through) has a fixed list of keys deleted.
// Own keys vanish; keys the opaque spread may hold stay as uncertain as the
// spread, and the copy itself is left alone rather than rewritten per key.

const OPTION_KEYS = [
  "defaultValue",
  "ordinal",
  "context",
  "replace",
  "lng",
  "lngs",
  "fallbackLng",
  "ns",
  "keySeparator",
  "nsSeparator",
  "returnObjects",
  "returnDetails",
  "joinArrays",
  "postProcess",
  "interpolation",
];

const readCallerOptions = (): Record<string, unknown> => {
  const raw = window.location.hash.slice(1);
  return raw === "" ? {} : JSON.parse(decodeURIComponent(raw));
};

const usedParams = (options: Record<string, unknown>): Record<string, unknown> => {
  const data = { ...options };
  for (const key of OPTION_KEYS) delete data[key];
  return data;
};

export default function DeleteThroughOpaqueSpread() {
  const [summary] = useState(() => {
    const options = { ...readCallerOptions(), count: 2, lng: "en", ns: "common" };
    const data = usedParams(options);
    const defaults = { defaultValue: "x", ordinal: true };
    const plain = usedParams({ ...defaults, count: 3 });
    return {
      count: data.count,
      plainCount: plain.count,
      plainKeys: Object.keys(plain).join(","),
      keptCallerCount: data.count === options.count,
    };
  });
  return (
    <dl>
      <dt>count</dt>
      <dd>{String(summary.count)}</dd>
      <dt>plain</dt>
      <dd>
        {String(summary.plainCount)} [{summary.plainKeys}]
      </dd>
      <dt>same</dt>
      <dd>{String(summary.keptCallerCount)}</dd>
    </dl>
  );
}
