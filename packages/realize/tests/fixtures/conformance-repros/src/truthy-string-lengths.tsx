export const NestedLength = ({ label }: { label?: string }) =>
  label ? label.length > 0 ? <i>yes</i> : <i>no</i> : <i>no</i>;

export const EmptyLength = ({ label }: { label: string }) =>
  !label ? label.length === 0 ? <i>empty</i> : <i>impossible</i> : <i>text</i>;

export const OptionalLength = ({ label }: { label?: string }) =>
  !label ? label?.length === 0 ? <i>empty</i> : <i>missing</i> : <i>text</i>;
