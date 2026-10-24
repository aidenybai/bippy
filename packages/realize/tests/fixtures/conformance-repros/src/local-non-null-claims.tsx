export const TernaryLocal = ({ isOn, label }: { isOn: boolean; label: string }) => {
  const value = isOn ? label : undefined;
  return <p>{value!.length}</p>;
};

export const AnnotatedLocal = ({ isOn, label }: { isOn: boolean; label: string }) => {
  const value: string | undefined = isOn ? label : undefined;
  return <p>{value!.length}</p>;
};

export const InlineTernary = ({ isOn, label }: { isOn: boolean; label: string }) => (
  <p>{(isOn ? label : undefined)!.length}</p>
);

export const StatementLocal = ({ isOn, label }: { isOn: boolean; label: string }) => {
  const value = isOn ? label : undefined;
  const size = value!.length;
  return <p>{size}</p>;
};
