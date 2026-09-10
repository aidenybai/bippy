import { createContext, useContext } from "react";
import { EventEmitter } from "./shared/node-events";

const emitter = new EventEmitter();

/** react-navigation's `NavigationContext`: the screen value is opaque, the root value is a known object. */
const ScreenContext = createContext<unknown>(undefined);
const RootContext = createContext<object | undefined>(undefined);

/** `useNavigation`: `opaque === undefined && known === undefined` can only be falsy. */
const useNavigation = (): unknown => {
  const root = useContext(RootContext);
  const navigation = useContext(ScreenContext);
  if (navigation === undefined && root === undefined) {
    throw new Error("Couldn't find a navigation object.");
  }
  return navigation ?? root;
};

/** `opaque === undefined || known === undefined` on `||`: the truthy side must stay truthy. */
const useHasNoScreen = (): boolean => {
  const root = useContext(RootContext);
  const navigation = useContext(ScreenContext);
  const isMissing = navigation === undefined || root === undefined;
  return isMissing === true ? true : false;
};

const Header = () => {
  useNavigation();
  return <header>{useHasNoScreen() ? <b>detached</b> : <i>attached</i>}</header>;
};

const Navigator = () => {
  const [first, second] = emitter.listeners("navigation");
  const screenNavigation = emitter.listenerCount("navigation") > 1 ? first : second;
  return (
    <ScreenContext.Provider value={screenNavigation}>
      <Header />
    </ScreenContext.Provider>
  );
};

export const isPartial = true;

export default function LogicalNarrowedSides() {
  return (
    <RootContext.Provider value={{ navigate: () => {} }}>
      <Navigator />
    </RootContext.Provider>
  );
}
