export default function EslBadge({ connected }) {
  return (
    <span className={`
      inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full
      ${connected
        ? 'bg-lamp-available/15 text-lamp-available border border-lamp-available/30'
        : 'bg-lamp-alert/15 text-lamp-alert border border-lamp-alert/30'}
    `}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-lamp-available' : 'bg-lamp-alert'}`} />
      {connected ? 'FS Connected' : 'FS Offline'}
    </span>
  );
}
