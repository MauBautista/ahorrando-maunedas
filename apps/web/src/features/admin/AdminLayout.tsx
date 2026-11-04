import { NavLink, Outlet } from 'react-router';

const TABS = [
  { to: '/admin/usuarios', label: 'Usuarios' },
  { to: '/admin/fusionar', label: 'Fusionar duplicados' },
  { to: '/admin/ia', label: 'Gasto de IA' },
  { to: '/admin/agente', label: 'Servidor casero' },
  { to: '/admin/home-assistant', label: 'Home Assistant' },
];

/** W-11 to W-13, W-22 and W-23 (admin only, 06 §3): the screens under one row of tabs. */
export function AdminLayout() {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Administración" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
