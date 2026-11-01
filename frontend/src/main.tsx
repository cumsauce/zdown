import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Client as Styletron } from 'styletron-engine-monolithic';
import { Provider as StyletronProvider } from 'styletron-react';
import { applyTheme } from './theme';
import { App } from './App';
import { Overlays } from './components/ui';
import './styles.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

const engine = new Styletron();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StyletronProvider value={engine}>
      <BrowserRouter>
        <App />
        <Overlays />
      </BrowserRouter>
    </StyletronProvider>
  </React.StrictMode>,
);
