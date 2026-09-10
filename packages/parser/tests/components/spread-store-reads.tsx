import { EventEmitter } from "./shared/node-events";

/**
 * A flux-style store spreads an opaque prototype, so a property it does not
 * declare may still come from the spread. Every read of that property is the
 * same value: two components testing it make one decision, two states.
 */
const store = Object.assign({}, EventEmitter.prototype, {
  isLoading: false,
  getUser(): { name: string } | null {
    return this.model;
  },
});

const Greeting = () => {
  const user = store.getUser();
  return <h1>{user ? <b>{user.name}</b> : <i>guest</i>}</h1>;
};

const Menu = () => (
  <nav>{store.getUser() ? <a href="/logout">log out</a> : <a href="/login">log in</a>}</nav>
);

export const isPartial = true;
export const stateCount = 2;

export default function SpreadStoreReads() {
  return (
    <>
      <Greeting />
      <Menu />
    </>
  );
}
