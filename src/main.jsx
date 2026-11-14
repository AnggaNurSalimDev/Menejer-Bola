import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Elemen #root tidak ditemukan di index.html');

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
