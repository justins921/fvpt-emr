import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '□', shortcut: 'Alt+H' },
  { path: '/schedule', label: 'Schedule', icon: '▦', shortcut: 'Alt+S' },
  { path: '/patients', label: 'Patients', icon: '♦', shortcut: 'Alt+P' },
  { path: '/billing', label: 'Billing', icon: '$', shortcut: 'Alt+B' },
  { path: '/admin', label: 'Admin', icon: '⚙', shortcut: '' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-primary-900 text-white transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-primary-800">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-primary-900 font-bold text-sm">PT</div>
          <div>
            <div className="font-semibold text-sm">FVPT EMR</div>
            <div className="text-xs text-primary-300">Local System</div>
          </div>
        </div>

        <nav className="mt-4 px-2 space-y-1">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm min-h-touch transition-colors ${
                isActive(item.path)
                  ? 'bg-primary-800 text-white'
                  : 'text-primary-200 hover:bg-primary-800/50 hover:text-white'
              }`}
            >
              <span className="text-lg w-6 text-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="text-xs text-primary-400 hidden xl:block">{item.shortcut}</span>}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-primary-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-sm font-medium">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</div>
              <div className="text-xs text-primary-300 capitalize">{user?.role?.replace('_', ' ')}</div>
            </div>
          </div>
          <button onClick={logout} className="w-full text-left text-sm text-primary-300 hover:text-white py-1">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-4 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 min-h-touch min-w-touch flex items-center justify-center"
          >
            <span className="text-xl">☰</span>
          </button>
          <div className="flex-1" />
          <div className="text-sm text-slate-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
