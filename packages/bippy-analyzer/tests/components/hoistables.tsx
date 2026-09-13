export default function Hoistables() {
  return (
    <article>
      <title>Document title</title>
      <meta name="description" content="hoisted" />
      <link rel="stylesheet" href="/styles.css" precedence="default" />
      <link rel="icon" href="/favicon.ico" />
      <link rel="stylesheet" href="/plain.css" />
      <style href="inline" precedence="default">{`.a { color: red; }`}</style>
      <script async src="/script.js" />
      <script>{`console.log("inline")`}</script>
      <svg viewBox="0 0 1 1">
        <title>svg title stays</title>
      </svg>
      <p>body</p>
    </article>
  );
}
