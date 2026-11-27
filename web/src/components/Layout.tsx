import { NavLink, Outlet } from 'react-router-dom';
import { useAdmin } from '../lib/admin-context';

const links = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/users', label: 'Usuários' },
  { to: '/admin/catalog', label: 'Catálogo e carteira' },
  { to: '/admin/subscriptions', label: 'Pacotes' },
  { to: '/admin/payments', label: 'Pagamentos' },
  { to: '/admin/queries', label: 'Consultas' },
  { to: '/admin/dsr', label: 'DSR' },
  { to: '/admin/settings', label: 'Configurações' },
];

export function Layout() {
  const { user, signOut } = useAdmin();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <NavLink to="/admin" className="text-lg font-bold text-white">
              Bot Consulta
            </NavLink>
            <nav className="flex flex-wrap gap-2 text-sm">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/admin'}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-2 transition-colors ${
                      isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-400 sm:inline">{user.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
