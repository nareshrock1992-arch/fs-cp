import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, PhoneCall, Users, Layers,
  Activity, BarChart3, Radio, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';

const BASE_NAV = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/live-calls',  label: 'Live Calls',  icon: PhoneCall },
  { to: '/queue-stats', label: 'Queue Stats', icon: Activity },
  { to: '/agents',      label: 'Agents',      icon: Users },
  { to: '/queues',      label: 'Queues',      icon: Layers },
];

const REPORTS_ITEM = { to: '/reports',  label: 'Reports',         icon: BarChart3 };
const USERS_ITEM   = { to: '/users',    label: 'User Management', icon: ShieldCheck };

export default function Sidebar() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canViewReports =
    isAdmin || (Array.isArray(user?.permissions) && user.permissions.includes('view_reports'));

  const navItems = [
    ...BASE_NAV,
    ...(canViewReports ? [REPORTS_ITEM] : []),
    ...(isAdmin        ? [USERS_ITEM]   : []),
  ];

  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0
      bg-panel-surface border-r border-panel-border">

      {/* Brand header */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-panel-border/70 shrink-0">
        <div className="h-8 w-8 rounded-xl bg-brand flex items-center justify-center shadow-lamp-blue shrink-0">
          <Radio size={15} className="text-white" />
        </div>
        <div className="leading-tight">
          <p className="font-display font-bold text-[15px] tracking-wide text-white">
            Switchboard
          </p>
          <p className="text-[9px] text-brand-light uppercase tracking-[0.15em] font-bold opacity-75">
            CC Admin
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-brand-light bg-brand/20 border border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'
                : 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-faint hover:text-ink-dim hover:bg-panel-raised transition-colors border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={17}
                  strokeWidth={isActive ? 2.25 : 1.75}
                  className={isActive ? 'text-brand-light' : ''}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-panel-border/60 shrink-0">
        <p className="text-[11px] font-semibold text-ink-faint tracking-wide">
          CC Version 1.0.0
        </p>
        <p className="text-[10px] text-ink-faint/50 mt-0.5">
          © Naresh — All Rights Reserved
        </p>
      </div>
    </aside>
  );
}
