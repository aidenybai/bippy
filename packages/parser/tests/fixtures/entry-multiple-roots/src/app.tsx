export const App = ({ title }: { title: string }) => (
  <main>
    <h1>{title}</h1>
    <ul>
      {["feed", "profile", "settings"].map((tab) => (
        <li key={tab}>{tab}</li>
      ))}
    </ul>
  </main>
);
