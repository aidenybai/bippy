export interface ExtractedDisplayName {
  baseComponentName: string;
  hocNames: string[];
}

export const extractHOCNames = (displayName: string): ExtractedDisplayName => {
  const hocNames: string[] = [];
  let baseComponentName = displayName;
  while (true) {
    const match = /^([A-Za-z_$][\w$]*)\((.*)\)$/.exec(baseComponentName);
    if (!match) break;
    hocNames.push(match[1]);
    baseComponentName = match[2];
  }
  return { baseComponentName, hocNames };
};
