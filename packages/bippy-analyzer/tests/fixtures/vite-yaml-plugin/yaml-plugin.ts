interface FlatYamlPlugin {
  name: string;
  transform: (code: string, id: string) => { code: string; map: null } | null;
}

/** A flat `key: value` YAML subset becomes the module's default export, as YAML loader plugins emit it. */
export const flatYamlPlugin = (): FlatYamlPlugin => ({
  name: "fixture-flat-yaml",
  transform: (code, id) => {
    if (!/\.ya?ml$/.test(id)) return null;
    const record: Record<string, string> = {};
    for (const line of code.split("\n")) {
      const separator = line.indexOf(": ");
      if (separator === -1) continue;
      record[line.slice(0, separator).trim()] = line.slice(separator + 2).trim();
    }
    return { code: `export default ${JSON.stringify(record)};`, map: null };
  },
});
