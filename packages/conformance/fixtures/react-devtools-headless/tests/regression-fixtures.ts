export interface ReactVersionFixture {
  major: number;
  reactPackageName: string;
  reactDOMPackageName: string;
  supportsEditing: boolean;
  supportsHooks: boolean;
  supportsProfiler: boolean;
  version: string;
}

const createReact16Fixture = (minor: number): ReactVersionFixture => ({
  major: 16,
  reactDOMPackageName: `react-dom-16-${minor}`,
  reactPackageName: `react-16-${minor}`,
  supportsEditing: minor >= 8,
  supportsHooks: minor >= 8,
  supportsProfiler: minor >= 5,
  version: `16.${minor}`,
});

const createModernFixture = (
  major: number,
  minor: number,
  reactPackageName = `react-${major}-${minor}`,
): ReactVersionFixture => ({
  major,
  reactDOMPackageName: reactPackageName.replace("react", "react-dom"),
  reactPackageName,
  supportsEditing: true,
  supportsHooks: true,
  supportsProfiler: true,
  version: `${major}.${minor}`,
});

export const reactVersionFixtures: ReactVersionFixture[] = [
  ...Array.from({ length: 9 }, (_, minor) => createReact16Fixture(minor)),
  createModernFixture(17, 0, "react-17"),
  createModernFixture(18, 0),
  createModernFixture(18, 2),
  createModernFixture(18, 3),
  createModernFixture(19, 0),
  createModernFixture(19, 1),
  createModernFixture(19, 2),
  createModernFixture(19, 3, "react"),
];
