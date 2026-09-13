import message from "./message.fixture";
import warnings from "./warnings.fixture";

const App = () => (
  <main>
    environment: {message} warnings: {warnings}
  </main>
);

export default App;
