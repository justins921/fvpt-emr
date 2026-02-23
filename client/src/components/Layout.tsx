import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/* ── Primary nav: always visible ── */
const PRIMARY_NAV = [
  { path: '/app', label: 'Dashboard', icon: '□' },
  { path: '/app/schedule', label: 'Schedule', icon: '▦' },
  { path: '/app/patients', label: 'Patients', icon: '♦' },
  { path: '/app/billing', label: 'Billing', icon: '$' },
  { path: '/app/messages', label: 'Messages', icon: '✉' },
];

/* ── Collapsible sections ── */
const SECTIONS = [
  {
    key: 'clinical',
    label: 'Clinical',
    items: [
      { path: '/app/exercises', label: 'Exercises / HEP', icon: '⚡' },
      { path: '/app/outcome-measures', label: 'Outcomes', icon: '◎' },
      { path: '/app/telehealth', label: 'Telehealth', icon: '◉' },
      { path: '/app/intake-forms', label: 'Intake Forms', icon: '✎' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { path: '/app/tasks', label: 'Tasks', icon: '☑' },
      { path: '/app/authorizations', label: 'Authorizations', icon: '✓' },
      { path: '/app/eligibility', label: 'Eligibility', icon: '⚕' },
      { path: '/app/reports', label: 'Reports', icon: '▤' },
      { path: '/app/payments', label: 'Payments', icon: '₹' },
      { path: '/app/waitlist', label: 'Waitlist', icon: '⏳' },
      { path: '/app/recall', label: 'Recall', icon: '↺' },
      { path: '/app/referring-providers', label: 'Ref. Providers', icon: '⇋' },
      { path: '/app/fax', label: 'Fax', icon: '⎙' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    items: [
      { path: '/app/locations', label: 'Locations', icon: '⌂' },
      { path: '/app/portal', label: 'Patient Portal', icon: '⊞' },
      { path: '/app/workers-comp', label: "Workers' Comp", icon: '⛑' },
      { path: '/app/mips', label: 'MIPS', icon: '★' },
      { path: '/app/fhir', label: 'FHIR', icon: '⇄' },
      { path: '/app/support', label: 'Support', icon: '?' },
      { path: '/app/admin', label: 'Settings', icon: '⚙' },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app';
    return location.pathname.startsWith(path);
  };

  // Auto-expand the section that contains the active route
  const activeSection = SECTIONS.find(s => s.items.some(i => isActive(i.path)));

  const isSectionOpen = (key: string) => {
    if (expanded[key] !== undefined) return expanded[key];
    return activeSection?.key === key;
  };

  const toggleSection = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !isSectionOpen(key) }));
  };

  const navLink = (item: { path: string; label: string; icon: string }) => (
    <Link
      key={item.path}
      to={item.path}
      onClick={() => setSidebarOpen(false)}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive(item.path)
          ? 'bg-primary-800 text-white'
          : 'text-primary-200 hover:bg-primary-800/50 hover:text-white'
      }`}
    >
      <span className="text-base w-5 text-center">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  );

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-primary-900 text-white transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-primary-800">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-primary-900 font-bold text-sm">OS</div>
          <div>
            <div className="font-semibold text-sm">EMR OS</div>
            <div className="text-xs text-primary-300">Sobojinski Solutions</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto mt-2 px-2 pb-4">
          {/* Primary nav - always visible */}
          <div className="space-y-0.5">
            {PRIMARY_NAV.map(navLink)}
          </div>

          {/* Collapsible sections */}
          {SECTIONS.map(section => (
            <div key={section.key} className="mt-3">
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary-400 hover:text-primary-200 transition-colors"
              >
                <span>{section.label}</span>
                <span className={`text-[10px] transition-transform ${isSectionOpen(section.key) ? 'rotate-180' : ''}`}>
                  &#9662;
                </span>
              </button>
              {isSectionOpen(section.key) && (
                <div className="space-y-0.5 mt-0.5">
                  {section.items.map(navLink)}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-primary-800">
          <div className="flex items-center gap-3 mb-2">
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
