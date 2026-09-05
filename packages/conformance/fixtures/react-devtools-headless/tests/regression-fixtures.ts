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

export const reactVersionFixtures: ReactVersionFixture[] = [
  ...Array.from({ length: 9 }, (_, minor) => createReact16Fixture(minor)),
  {
    major: 17,
    reactDOMPackageName: "react-dom-17",
    reactPackageName: "react-17",
    supportsEditing: true,
    supportsHooks: true,
    supportsProfiler: true,
    version: "17.0",
  },
  {
    major: 18,
    reactDOMPackageName: "react-dom-18-0",
    reactPackageName: "react-18-0",
    supportsEditing: true,
    supportsHooks: true,
    supportsProfiler: true,
    version: "18.0",
  },
  {
    major: 18,
    reactDOMPackageName: "react-dom-18-2",
    reactPackageName: "react-18-2",
    supportsEditing: true,
    supportsHooks: true,
    supportsProfiler: true,
    version: "18.2",
  },
];
