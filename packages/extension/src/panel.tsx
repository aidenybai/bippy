import { createRoot } from 'react-dom/client';
import './panel.css';

const Panel = () => {
  return (
    <div className="panel-container">
      <h1>Bippy DevTools</h1>
      <p>React Fiber inspector</p>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<Panel />);
}
