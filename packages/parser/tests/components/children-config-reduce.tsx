import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

interface ScreenProps {
  name: string;
  getComponent: () => () => ReactElement;
}

const Screen = (_props: ScreenProps): null => null;

interface ScreenConfig {
  props: ScreenProps;
}

const getConfigsFromChildren = (children: ReactNode): ScreenConfig[] =>
  Children.toArray(children).reduce<ScreenConfig[]>((configs, child) => {
    if (isValidElement<ScreenProps>(child)) {
      if (child.type === Screen) {
        if (typeof child.props.name !== "string" || child.props.name === "") {
          throw new Error("Got an invalid name for the screen.");
        }
        configs.push({ props: child.props });
        return configs;
      }
      if (child.type === Fragment) {
        configs.push(...getConfigsFromChildren(child.props.children));
        return configs;
      }
    }
    throw new Error(
      "A navigator can only contain 'Screen' or 'React.Fragment' as its direct children.",
    );
  }, []);

const Navigator = ({ children }: { children: ReactNode }) => {
  const configs = getConfigsFromChildren(children);
  const routeNames = configs.map((config) => config.props.name);
  if (!routeNames.length) {
    throw new Error("Couldn't find any screens for the navigator.");
  }
  const screens: Record<string, ScreenConfig> = {};
  const keys: Record<string, string | undefined> = {};
  routeNames.forEach((name) => {
    const config = configs.find((candidate) => candidate.props.name === name);
    if (config === undefined) throw new Error(`missing ${name}`);
    screens[name] = config;
    keys[name] = undefined;
  });
  const first = screens[routeNames[0] ?? ""];
  const Active = first?.props.getComponent();
  return (
    <nav data-count={routeNames.length}>
      <ul>
        {routeNames.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {Active ? <Active /> : null}
    </nav>
  );
};

const Home = () => <main>home</main>;
const Search = () => <main>search</main>;

const commonScreens = (label: string) => (
  <>
    <Screen name="NotFound" getComponent={() => () => <p>{label}</p>} />
    <Screen name="Lists" getComponent={() => () => <p>lists</p>} />
  </>
);

export const isExact = true;

export default function ChildrenConfigReduce() {
  return (
    <Navigator>
      <Screen name="Home" getComponent={() => Home} />
      <Screen name="Search" getComponent={() => Search} />
      {commonScreens("not found")}
    </Navigator>
  );
}
