import { Component, createContext, useContext } from "react";
import type { ReactNode } from "react";

const DepthContext = createContext(0);
const InitialIdentity = {};
const FinalIdentity = {};
const IdentityContext = createContext(InitialIdentity);

const NestedFunction = (): ReactNode => {
  const depth = useContext(DepthContext);
  if (depth === 2)
    return (
      <span>
        {"function: "}
        {depth}
      </span>
    );
  return (
    <DepthContext.Provider value={depth + 1}>
      <section>
        <NestedFunction />
      </section>
    </DepthContext.Provider>
  );
};

class NestedClass extends Component {
  static contextType = DepthContext;
  declare context: number;

  render = (): ReactNode => {
    if (this.context === 2)
      return (
        <strong>
          {"class: "}
          {this.context}
        </strong>
      );
    return (
      <DepthContext.Provider value={this.context + 1}>
        <article>
          <NestedClass />
        </article>
      </DepthContext.Provider>
    );
  };
}

const NestedIdentity = (): ReactNode => {
  const identity = useContext(IdentityContext);
  if (identity === FinalIdentity) return <aside />;
  return (
    <IdentityContext.Provider value={FinalIdentity}>
      <NestedIdentity />
    </IdentityContext.Provider>
  );
};

export default () => (
  <main>
    <NestedFunction />
    <NestedClass />
    <IdentityContext.Provider value={InitialIdentity}>
      <NestedIdentity />
    </IdentityContext.Provider>
  </main>
);

export const isExact = true;
