import 'bippy/dist/index';
import Inspector from 'bippy/dist/experiments/inspect';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
// @ts-ignore
import './main.css';

const rootElement = document.getElementById('root');
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <Inspector enabled={true} dangerouslyRunInProduction={true} />
      <App />
    </StrictMode>,
  );
}
