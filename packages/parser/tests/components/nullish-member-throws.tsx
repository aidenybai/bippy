interface Profile {
  label: string;
}

const profiles: Record<string, Profile | null | undefined> = {
  present: { label: "Present" },
  missing: null,
  unset: undefined,
};

const readLabel = (key: string): string => {
  try {
    return profiles[key]!.label;
  } catch (error) {
    if (error instanceof TypeError) return `type error: ${error.message}`;
    return "other error";
  }
};

const readLength = (key: string): number => {
  try {
    return profiles[key]!.label.length;
  } catch {
    return -1;
  }
};

export default function NullishMemberThrows() {
  return (
    <ul>
      <li>{readLabel("present")}</li>
      <li>{readLabel("missing")}</li>
      <li>{readLabel("unset")}</li>
      <li>{readLength("missing")}</li>
    </ul>
  );
}
