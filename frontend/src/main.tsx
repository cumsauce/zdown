import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Client as Styletron } from 'styletron-engine-monolithic';
import { Provider as StyletronProvider } from 'styletron-react';
import { BaseProvider } from 'baseui';
import { ToasterContainer, PLACEMENT } from 'baseui/toast';
import { theme } from './theme';
import { App } from './App';
import './styles.css';

const engine = new Styletron();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StyletronProvider value={engine}>
      <BaseProvider theme={theme}>
        <ToasterContainer placement={PLACEMENT.bottomRight} autoHideDuration={4000}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToasterContainer>
      </BaseProvider>
    </StyletronProvider>
  </React.StrictMode>,
);
