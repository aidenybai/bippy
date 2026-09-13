import { EventEmitter } from "./shared/node-events";

/** The listener is read from an opaque module: an unknown input the guards below all range over. */
const emitter = new EventEmitter();

interface Viewer {
  role: string;
  isVerified: boolean;
}

const readViewer = (): Viewer | undefined => {
  const listener: unknown = emitter.listeners("viewer")[0];
  return typeof listener === "object" && listener !== null ? (listener as Viewer) : undefined;
};

const Badge = ({ viewer }: { viewer: Viewer | undefined }) =>
  viewer ? <em>{viewer.role}</em> : <em>guest</em>;

const Toolbar = ({ viewer }: { viewer: Viewer | undefined }) => {
  const isAdmin = viewer?.role === "admin";
  return (
    <nav>
      {isAdmin ? <button type="button">settings</button> : null}
      {viewer?.role === "admin" && <a href="/audit">audit</a>}
      <Badge viewer={viewer} />
    </nav>
  );
};

export const isPartial = true;

export default function CorrelatedGuards() {
  const viewer = readViewer();
  return (
    <main>
      <Toolbar viewer={viewer} />
      {viewer ? (
        <footer>{viewer.isVerified ? <b>verified</b> : <i>unverified</i>}</footer>
      ) : (
        <p>sign in</p>
      )}
    </main>
  );
}
