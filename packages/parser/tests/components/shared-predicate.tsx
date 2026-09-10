import { createContext, useContext } from "react";
import { EventEmitter } from "./shared/node-events";

/** The listener comes out of an opaque module, so nothing about it is known statically. */
const emitter = new EventEmitter();

const LoadingContext = createContext(false);

/** Tested as is, negated, and again inside a branch it already decided: one decision, two states. */
const Header = () => {
  const isLoading = useContext(LoadingContext);
  if (isLoading) return <header>loading</header>;
  return <header>{isLoading ? <b>never</b> : <i>ready</i>}</header>;
};

const Body = () => {
  const isLoading = useContext(LoadingContext);
  return <main>{!isLoading && <p>content</p>}</main>;
};

const Footer = () => {
  const isLoading = useContext(LoadingContext);
  const isReady = !isLoading;
  return <footer>{isReady ? <span>done</span> : <span>wait</span>}</footer>;
};

export const isPartial = true;
export const stateCount = 2;

export default function SharedPredicate() {
  const isLoading = emitter.listeners("load").length > 0;
  return (
    <LoadingContext.Provider value={isLoading}>
      <Header />
      <Body />
      <Footer />
    </LoadingContext.Provider>
  );
}
