// The "lamp" is this UI's signature element: a small LED-style indicator
// modeled on physical PBX/ACD status panels, since every agent here is
// quite literally a line lamp on a switchboard between FreeSWITCH and Avaya.

const LAMP_MAP = {
  Available: { color: 'bg-lamp-available', glow: 'shadow-lamp-green', pulse: false, label: 'Available' },
  'On Break': { color: 'bg-lamp-break', glow: 'shadow-lamp-blue', pulse: false, label: 'On Break' },
  'Logged Out': { color: 'bg-lamp-loggedout', glow: '', pulse: false, label: 'Logged Out' },
  Waiting: { color: 'bg-lamp-available', glow: 'shadow-lamp-green', pulse: false, label: 'Waiting' },
  Receiving: { color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true, label: 'Ringing' },
  'In a queue call': { color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true, label: 'On a Call' },
  InQueue: { color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true, label: 'In Queue' },
  Abandoned: { color: 'bg-lamp-alert', glow: 'shadow-lamp-red', pulse: false, label: 'Abandoned' },
  Offline: { color: 'bg-lamp-alert', glow: '', pulse: false, label: 'Offline' }
};

export default function StatusLamp({ status, label, size = 'md', showLabel = true }) {
  const cfg = LAMP_MAP[status] || { color: 'bg-ink-faint', glow: '', pulse: false, label: status || 'Unknown' };
  const dimensions = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`rounded-full ${dimensions} ${cfg.color} ${cfg.glow} ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
        aria-hidden="true"
      />
      {showLabel && (
        <span className="text-xs font-medium text-ink-dim font-display tracking-wide uppercase">
          {label || cfg.label}
        </span>
      )}
    </span>
  );
}
