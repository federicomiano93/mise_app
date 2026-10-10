import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Foundations } from './Foundations';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Mise 2 cannot start: index.html has no element with id="root".');
}

createRoot(container).render(
  <StrictMode>
    <Foundations />
  </StrictMode>,
);
