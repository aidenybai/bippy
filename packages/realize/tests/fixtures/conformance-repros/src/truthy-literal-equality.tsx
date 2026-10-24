export const OrFallback = ({ label }: { label?: string }) => {
  const text = label || "fallback";
  return text === "" ? <i>yes</i> : <i>no</i>;
};

export const TernaryFallback = ({ label }: { label?: string }) => {
  const text = label ? label : "fallback";
  return text === "" ? <i>yes</i> : <i>no</i>;
};

export const HelperFallback = ({ label }: { label?: string }) => {
  const format = (value?: string) => value || "fallback";
  return format(label) === "" ? <i>yes</i> : <i>no</i>;
};

export const LooseFallback = ({ count }: { count?: number }) => {
  const value = count || "0";
  return value == 0 ? <i>yes</i> : <i>no</i>;
};
