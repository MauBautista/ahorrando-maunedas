import type { RouteObject } from 'react-router';
import { Layout } from './app/Layout';
import { RouteError } from './app/RouteError';
import { ComingSoon } from './components/ComingSoon';
import { RequireAdmin, RequireSession } from './features/auth/session';

const soon = (title: string) => ({ element: <ComingSoon title={title} /> });

/**
 * The routes of 06 §3. Each screen is its own chunk (`lazy`); the ones of later tasks say "llega pronto" until
 * then (T-161 to T-166).
 */
export const routes: RouteObject[] = [
  {
    path: '/login',
    lazy: () => import('./features/auth/LoginPage').then((m) => ({ Component: m.LoginPage })),
    errorElement: <RouteError />,
  },
  {
    element: <RequireSession />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Layout />,
        children: [
          {
            index: true,
            lazy: () => import('./features/home/HomePage').then((m) => ({ Component: m.HomePage })),
          },
          { path: 'compras', ...soon('Compras') },
          { path: 'compras/nueva', ...soon('Nueva compra') },
          { path: 'compras/:id', ...soon('Compra') },
          { path: 'compras/:id/editar', ...soon('Editar compra') },
          { path: 'compras/:id/ticket', ...soon('Revisión de ticket') },
          {
            path: 'catalogo',
            lazy: () => import('./features/catalog/CatalogPage').then((m) => ({ Component: m.CatalogPage })),
          },
          { path: 'productos/nuevo', ...soon('Nuevo producto') },
          {
            path: 'productos/:id',
            lazy: () => import('./features/catalog/ProductPage').then((m) => ({ Component: m.ProductPage })),
          },
          { path: 'productos/:id/editar', ...soon('Editar producto') },
          { path: 'anaquel/nuevo', ...soon('Precio de anaquel') },
          {
            path: 'cuenta',
            lazy: () => import('./features/account/AccountPage').then((m) => ({ Component: m.AccountPage })),
          },
          {
            path: 'admin',
            element: <RequireAdmin />,
            children: [
              { path: 'usuarios', ...soon('Usuarios') },
              { path: 'fusionar', ...soon('Fusionar duplicados') },
              { path: 'ia', ...soon('Gasto de IA') },
            ],
          },
          { path: '*', element: <ComingSoon title="No encontramos esta página" /> },
        ],
      },
    ],
  },
];
