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
          {
            path: 'compras',
            lazy: () =>
              import('./features/purchases/PurchasesPage').then((m) => ({ Component: m.PurchasesPage })),
          },
          {
            path: 'compras/nueva',
            lazy: () =>
              import('./features/purchases/editor/PurchaseEditorPage').then((m) => ({
                Component: m.PurchaseEditorPage,
              })),
          },
          {
            path: 'compras/:id',
            lazy: () =>
              import('./features/purchases/PurchasePage').then((m) => ({ Component: m.PurchasePage })),
          },
          {
            path: 'compras/:id/editar',
            lazy: () =>
              import('./features/purchases/editor/PurchaseEditorPage').then((m) => ({
                Component: m.PurchaseEditorPage,
              })),
          },
          { path: 'compras/:id/ticket', ...soon('Revisión de ticket') },
          {
            path: 'catalogo',
            lazy: () => import('./features/catalog/CatalogPage').then((m) => ({ Component: m.CatalogPage })),
          },
          {
            path: 'productos/nuevo',
            lazy: () =>
              import('./features/catalog/editor/ProductEditorPage').then((m) => ({
                Component: m.ProductEditorPage,
              })),
          },
          {
            path: 'productos/:id',
            lazy: () => import('./features/catalog/ProductPage').then((m) => ({ Component: m.ProductPage })),
          },
          {
            path: 'productos/:id/editar',
            lazy: () =>
              import('./features/catalog/editor/ProductEditorPage').then((m) => ({
                Component: m.ProductEditorPage,
              })),
          },
          {
            path: 'anaquel/nuevo',
            lazy: () => import('./features/shelf/ShelfPage').then((m) => ({ Component: m.ShelfPage })),
          },
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
