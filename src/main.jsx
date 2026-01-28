import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

/**
 * Este es el archivo principal de entrada para React.
 * Se encarga de montar el componente <App /> en el elemento con id 'root'.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

