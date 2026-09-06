export const App = () => (
  <article>
    <title>Static title</title>
    <meta name="description" content="hoisted" />
    <link rel="stylesheet" href="/theme.css" precedence="default" />
    <script async src="/analytics.js" />
    <textarea defaultValue="text child" />
    <option value="a">Option A</option>
    <noscript>no js</noscript>
    <pre>preformatted</pre>
    <svg viewBox="0 0 1 1">
      <circle r="1" />
    </svg>
    <input value="x" readOnly />
  </article>
);
