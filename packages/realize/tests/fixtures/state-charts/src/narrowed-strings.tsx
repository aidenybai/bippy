export const HintField = ({ hint }: { hint?: string }) => (
  <label>
    {!hint ? <p>Add a hint</p> : null}
    {hint ? <small>{hint}</small> : <small>No hint yet</small>}
  </label>
);

export const ToneBadge = ({ tone }: { tone?: string }) => (
  <span>
    {tone === "info" ? <b>Info</b> : null}
    {tone === "warning" ? <i>Warning</i> : null}
  </span>
);
