interface FontOption {
  label: string;
  value: string;
}

const FONT_FAMILIES = ["Arial", "Calibri", "Source Code Pro"];

const isSupportedFont = (family: string): boolean => {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  context.font = `12px ${family}`;
  return context.measureText("mmm").width !== 0;
};

const listFonts = (): FontOption[] => {
  const options: FontOption[] = [];
  for (const family of FONT_FAMILIES) {
    if (isSupportedFont(family)) options.push({ label: family, value: family });
  }
  return options;
};

const FontPicker = () => {
  const options = listFonts();
  const labels: string[] = ["default"];
  if (document.title.length > 3) labels.push("titled");
  else labels.push("untitled");
  return (
    <fieldset>
      <select>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p>{labels.join(" ")}</p>
      <em>{options.length}</em>
    </fieldset>
  );
};

export const isPartial = true;
export const isEnumerated = true;

export default function UncertainPushes() {
  return <FontPicker />;
}
