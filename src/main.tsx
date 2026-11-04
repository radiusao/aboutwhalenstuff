import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadNotes } from './data/messages';
import { loadArt } from './world/art';
import './index.css';

// Her drawings swap in as they arrive; nothing waits for them.
loadArt();

// The notes are read before the sea starts, so the day's bottle draws from the right list.
await loadNotes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Ask the browser to keep the saved sea through storage pressure. Safari and Chrome decide
// quietly; the answer changes nothing here (the cloud copy covers the rest).
try {
  navigator.storage?.persist?.().catch(() => undefined);
} catch {
  // Ignore.
}
