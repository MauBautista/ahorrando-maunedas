import { NavLink } from 'react-router';

const TABS = [
  { to: '/catalogo', label: 'Productos' },
  { to: '/seguimiento', label: 'Seguimiento' },
  { to: '/alertas', label: 'Alertas' },
];

/** Tracking lives inside Catálogo, as on Android (05 §4): products, tracked links and alerts. */
export function CatalogTabs() {
  return (
    <nav aria-label="Catálogo" className="flex flex-wrap gap-1">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
