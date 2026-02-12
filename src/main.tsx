import { Buffer } from 'buffer';

// Polyfill Buffer for gray-matter (Node.js API in browser context)
globalThis.Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
