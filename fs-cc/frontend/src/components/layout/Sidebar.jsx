import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, PhoneCall, Users, Layers,
  Activity, BarChart3, Radio
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/live-calls',  label: 'Live Calls',  icon: PhoneCall },
  { to: '/agents',      label: 'Agents',      icon: Users },
  { to: '/queues',      label: 'Queues',      icon: Layers },
  { to: '/queue-stats', label: 'Queue Stats', icon: Activity },
  { to: '/reports',     label: 'Reports',     icon: BarChart3 }
];

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0
      bg-[#08111E] border-r border-[#1C2A42]">

      {/* Brand header */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-[#1C2A42]">
        <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center shadow-lamp-blue shrink-0">
          <Radio size={15} className="text-white" />
        </div>
        <div className="leading-tight">
          <p className="font-display font-bold text-[15px] tracking-wide text-white">Switchboard</p>
          <p className="text-[9px] text-blue-400/70 uppercase tracking-[0.15em] font-semibold">CC Admin</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? 'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold text-white bg-brand/20 border border-brand/30'
                : 'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-blue-200/50 hover:text-blue-100 hover:bg-white/5 transition-colors border border-transparent'
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} strokeWidth={isActive ? 2 : 1.75}
                  className={isActive ? 'text-brand-light' : ''} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#1C2A42]">
        <p className="text-[11px] font-semibold text-blue-300/50 tracking-wide">
          CC Version 1.0.0
        </p>
        <p className="text-[10px] text-blue-400/30 mt-0.5">
          © Naresh — All Rights Reserved
        </p>
      </div>
    </aside>
  );
}
