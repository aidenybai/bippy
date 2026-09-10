import { Children, isValidElement, useMemo, type ReactElement, type ReactNode } from "react";

interface ScreenProps {
  name: string;
}

interface ProtectedProps {
  guard: boolean;
  children: ReactNode;
}

const Screen = (_props: ScreenProps): null => null;
const Protected = (_props: ProtectedProps): null => null;

const isScreen = (child: unknown): child is ReactElement<ScreenProps> =>
  isValidElement(child) && child.type === Screen;
const isProtected = (child: unknown): child is ReactElement<ProtectedProps> =>
  isValidElement(child) && child.type === Protected;

const useScreens = (children: ReactNode) =>
  useMemo(() => {
    const screens: ScreenProps[] = [];
    const hidden = new Set<string>();
    const flattenChild = (child: ReactNode, isExcluded: boolean): void => {
      if (isProtected(child)) {
        const isChildExcluded = isExcluded || !child.props.guard;
        Children.forEach(child.props.children, (protectedChild) =>
          flattenChild(protectedChild, isChildExcluded),
        );
        return;
      }
      if (!isScreen(child)) return;
      if (isExcluded) hidden.add(child.props.name);
      else screens.push({ ...child.props });
    };
    Children.forEach(children, (child) => flattenChild(child, false));
    const names = screens.map((screen) => screen.name);
    if (new Set(names).size !== names.length) {
      throw new Error(`Screen names must be unique: ${names}`);
    }
    return { screens, hidden };
  }, [children]);

const Navigator = ({ children }: { children: ReactNode }) => {
  const { screens, hidden } = useScreens(children);
  return (
    <ul data-hidden={[...hidden].join(",")}>
      {screens.map((screen) => (
        <li key={screen.name}>{screen.name}</li>
      ))}
    </ul>
  );
};

const GuardedScreenNames = () => {
  const isLoggedIn = Math.random() > 0.5;
  return (
    <Navigator>
      <Protected guard={isLoggedIn}>
        <Screen name="home" />
      </Protected>
      <Protected guard={!isLoggedIn}>
        <Screen name="login" />
      </Protected>
      <Screen name="missing" />
    </Navigator>
  );
};

export default GuardedScreenNames;
export const isPartial = true;
