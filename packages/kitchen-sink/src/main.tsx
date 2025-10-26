import 'bippy/dist/index';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import App from './app';
import Inspector from './inspector';
// @ts-expect-error - CSS import type checking
import './main.css';

const rootElement = document.getElementById('root');
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <Inspector dangerouslyRunInProduction={true} enabled={true} />
      <App />
    </StrictMode>,
  );
}
