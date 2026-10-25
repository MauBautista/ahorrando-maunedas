import { NavLink, Outlet } from 'react-router';
import { APP_NAME } from '../app-info';
import { useMe } from '../features/auth/useSession';

interface Tab {
  to: string;
  label: string;
  end?: boolean;
}

/** The four tabs of the phone app (05 §4), as the web's navigation: across the top on a wide screen, below on a phone. */
const TABS: Tab[] = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/compras', label: 'Compras' },
  { to: '/catalogo', label: 'Catálogo' },
  { to: '/cuenta', label: 'Cuenta' },
];

const ADMIN_TAB: Tab = { to: '/admin/usuarios', label: 'Administración' };

function tabClass({ isActive }: { isActive: boolean }) {
  return `tab ${isActive ? 'tab-active' : ''}`;
}

/** The signed-in shell (06 §3, §7): header, navigation and the page, inside the iPhone's safe areas. */
export function Layout() {
  const { data } = useMe();
  const tabs = data?.user.role === 'admin' ? [...TABS, ADMIN_TAB] : TABS;
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <header className="sticky top-0 z-10 border-b border-outline/30 bg-surface px-4">
        <div className="mx-auto flex max-w-5xl items-center gap-6 py-3">
          <span className="text-title">{APP_NAME}</span>
          <nav aria-label="Principal" className="hidden gap-1 md:flex">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={tabClass}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 md:pb-8">
        <Outlet />
      </main>
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-outline/30 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
