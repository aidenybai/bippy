import type { ReactNode } from "react";

interface Notice {
  type: "success" | "error" | "info";
  title?: string;
  dismissible: boolean;
}

export const NoticeCard = ({ notice, children }: { notice: Notice; children?: ReactNode }) => (
  <div>
    {notice.type === "success" ? (
      <span>ok</span>
    ) : notice.type === "error" ? (
      <b>bad</b>
    ) : (
      <i>info</i>
    )}
    {notice.dismissible && <button>close</button>}
    {children === undefined ? <p>empty</p> : children}
  </div>
);

export const Runs = ({ runs, label }: { runs: string[]; label: string | null }) => (
  <section>
    {runs.length > 1 ? <span>many</span> : <span>few</span>}
    {label === null ? <em>none</em> : <strong>{label}</strong>}
  </section>
);

export const Flags = ({
  a,
  b,
  c,
  d,
}: {
  a: boolean;
  b: boolean;
  c: boolean;
  d: "x" | "y" | "z";
}) => (
  <div>
    {a && b ? <span>ab</span> : null}
    {c && d === "z" ? <i>cz</i> : <b>other</b>}
  </div>
);

interface Photo {
  make: string | null;
  iso: number | null;
}

export const PhotoDetails = ({ photo }: { photo: Photo }) => (
  <dl>
    {photo.make ? <dt>make</dt> : null}
    {photo.iso ? <dd>iso</dd> : null}
  </dl>
);

interface Reply {
  message: string;
  isLoading: boolean;
}

export const ReplyCard = ({ reply }: { reply: Reply }) =>
  reply.message ? <p>message</p> : reply.isLoading ? <i>loading</i> : <b>empty</b>;
