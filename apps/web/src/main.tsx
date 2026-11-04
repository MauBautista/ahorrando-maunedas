import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app/providers';
import { createApi } from './lib/api';
import { firebaseAuth } from './lib/firebase';
import { createQueryClient } from './lib/queryClient';
import { routes } from './router';
import './styles/app.css';

// Installable and readable without network (T-310): only the built app has a service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

const auth = firebaseAuth();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppProviders auth={auth} api={createApi(auth)} queryClient={createQueryClient()}>
        <RouterProvider router={createBrowserRouter(routes)} />
      </AppProviders>
    </StrictMode>,
  );
}
