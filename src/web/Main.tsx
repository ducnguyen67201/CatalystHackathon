import { createRoot } from 'react-dom/client';
import { ConversationProvider } from '@elevenlabs/react';
import { App } from './App.js';
import { VoicePracticePage } from './VoicePracticePage.js';
import './Styles.css';
import './Dashboard.css';
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ConversationProvider>
      {window.location.pathname === '/scenarios' ? (
        <VoicePracticePage page="scenarios" />
      ) : ['/voice', '/practice'].includes(window.location.pathname) ? (
        <VoicePracticePage />
      ) : (
        <App />
      )}
    </ConversationProvider>,
  );
}
