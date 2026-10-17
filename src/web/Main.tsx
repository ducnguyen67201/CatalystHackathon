import { createRoot } from 'react-dom/client';
import { ConversationProvider } from '@elevenlabs/react';
import { App } from './App.js';
import './Styles.css';
import './Dashboard.css';
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ConversationProvider>
      <App />
    </ConversationProvider>,
  );
}
