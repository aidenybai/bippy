import message from "./message.fixture";

const App = () => (
  <main>
    mode: {message} inline: {import.meta.env.MODE}
  </main>
);

export default App;
