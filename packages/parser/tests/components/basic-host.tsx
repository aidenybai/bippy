export default function BasicHost() {
  return (
    <main className="app">
      <header>
        <h1>Title</h1>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <section>
        <p>
          Some <strong>bold</strong> text
        </p>
        <img src="/logo.png" alt="logo" />
      </section>
    </main>
  );
}
