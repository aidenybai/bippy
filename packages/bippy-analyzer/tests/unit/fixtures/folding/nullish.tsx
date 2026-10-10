// @ts-nocheck
export const OptionalOnUndefined = () => {
  const data: { label: string } | undefined = undefined;
  return <p>{data?.label}</p>;
};

export const CoalesceUndefined = () => {
  const value = undefined;
  return <p>{value ?? "fallback"}</p>;
};

export const CoalesceNull = ({ label }: { label: string }) => {
  const value = null;
  return <p>{value ?? label}</p>;
};

export const CoalesceDefined = () => {
  const value = "set";
  return <p>{value ?? "fallback"}</p>;
};

export const UnknownNullCheck = ({ value }: { value: any }) =>
  // oxlint-disable-next-line eqeqeq -- Tests a loose null check as written.
  value != null ? <p>Present</p> : <p>Missing</p>;

export const UnknownCoalesce = ({ value }: { value: any }) => <p>{value ?? "fallback"}</p>;

export const OptionalOnNull = () => {
  const data: { label: string } | null = null;
  return <p>{data?.label}</p>;
};
