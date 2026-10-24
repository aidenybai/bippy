export const Byline = ({ author, editor }: { author?: string; editor?: string }) => (
  <p>
    {author || editor ? <b>credited</b> : null}
    {author || editor ? null : <i>anonymous</i>}
  </p>
);
