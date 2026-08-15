import { Wifi, WifiOff } from 'lucide-react';

export default function EslBadge({ connected }) {
  return (
    <span className={`
      inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full
      border transition-colors
      ${connected
        ? 'bg-lamp-available/15 text-lamp-available border-lamp-available/30'
        : 'bg-lamp-alert/15 text-lamp-alert border-lamp-alert/30 animate-pulse-soft'}
    `}>
      {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
      {connected ? 'FS Connected' : 'FS Offline'}
    </span>
  );
}
