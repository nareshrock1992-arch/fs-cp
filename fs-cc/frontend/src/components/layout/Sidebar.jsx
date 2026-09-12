import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, PhoneCall, Users, Layers,
  Activity, BarChart3, Radio, ShieldCheck, Coffee, History,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';

const BASE_NAV = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/live-calls',  label: 'Live Calls',  icon: PhoneCall },
  { to: '/queue-stats', label: 'Queue Stats', icon: Activity },
  { to: '/agents',      label: 'Agents',      icon: Users },
  { to: '/queues',      label: 'Queues',      icon: Layers },
];

const MANAGEMENT_PATHS = ['/reports', '/reports/break-history', '/reports/call-history', '/break-codes', '/users'];

const REPORTS_ITEM       = { to: '/reports',                label: 'Reports',         icon: BarChart3 };
const BREAK_HISTORY_ITEM = { to: '/reports/break-history',  label: 'Break History',   icon: History };
const CALL_HISTORY_ITEM  = { to: '/reports/call-history',   label: 'Call History',    icon: PhoneCall };
const BREAK_CODES_ITEM   = { to: '/break-codes',            label: 'Break Codes',     icon: Coffee };
const USERS_ITEM         = { to: '/users',                  label: 'User Management', icon: ShieldCheck };

// ── Light-mode enterprise navigation tab styling ──────────────────────────────
// Colours are hard-coded standard-Tailwind values (gray-200 #E5E7EB, slate-700
// #334155, slate-500 #64748B, slate-400 #94A3B8, slate-50 #F8FAFC, blue-50
// #EFF6FF, blue-600 #2563EB) so the sidebar renders as a white enterprise panel
// WITHOUT touching the shared panel-*/ink-* tokens used by the dashboard.
const NAV_BASE =
  'group relative flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-blue-500/40 focus-visible:ring-offset-0';
const NAV_INACTIVE =
  'font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900';
const NAV_ACTIVE =
  'font-semibold text-blue-600 bg-blue-50';

function NavItem({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`
      }
    >
      {({ isActive }) => (
        <>
          {/* Subtle active left indicator */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-blue-600"
            />
          )}
          <Icon
            size={19}
            strokeWidth={isActive ? 2.1 : 1.75}
            className={isActive ? 'text-blue-600 shrink-0' : 'text-slate-500 group-hover:text-slate-700 shrink-0'}
          />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  const canViewReports    = isAdmin || perms.includes('view_reports');
  const canManageBreaks   = isAdmin || perms.includes('manage_break_codes');

  const navItems = [
    ...BASE_NAV,
    ...(canViewReports  ? [REPORTS_ITEM, BREAK_HISTORY_ITEM, CALL_HISTORY_ITEM] : []),
    ...(canManageBreaks ? [BREAK_CODES_ITEM] : []),
    ...(isAdmin         ? [USERS_ITEM] : []),
  ];

  const operationsItems = navItems.filter(({ to }) => !MANAGEMENT_PATHS.includes(to));
  const managementItems = navItems.filter(({ to }) => MANAGEMENT_PATHS.includes(to));

  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0
      bg-white border-r border-gray-200">

      {/* Brand header */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-gray-200 shrink-0">
        <div className="h-8 w-8 rounded-xl bg-brand flex items-center justify-center shadow-lamp-blue shrink-0">
          <Radio size={15} className="text-white" />
        </div>
        <div className="leading-tight">
          <p className="font-display font-bold text-[15px] tracking-wide text-slate-800">
            Switchboard
          </p>
          <p className="text-[9px] text-blue-600 uppercase tracking-[0.15em] font-bold">
            CC Admin
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="px-3 pb-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
          Operations
        </p>
        <div className="space-y-1">
          {operationsItems.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        {(canViewReports || canManageBreaks || isAdmin) && (
          <>
            <p className="px-3 pt-6 pb-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
              Management
            </p>
            <div className="space-y-1">
              {managementItems.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-gray-200 shrink-0">
        <p className="text-[11px] font-semibold text-slate-500 tracking-wide">
          CC Version 1.0.0
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          © Naresh — All Rights Reserved
        </p>
      </div>
    </aside>
  );
}
