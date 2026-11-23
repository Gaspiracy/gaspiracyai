import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// PWA install banner: catch the beforeinstallprompt event as early as
// possible and stash it on window, so the banner component never misses
// it if the event fires before React mounts.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { __gaspiracyInstallPrompt?: Event }).__gaspiracyInstallPrompt = e;
});

createRoot(document.getElementById('root')!).render(<App />);

// PWA: register the service worker in production only, so local dev
// never serves cached assets.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
