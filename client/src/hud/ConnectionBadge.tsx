import { useWorldStore, type ConnectionStatus } from '../state/store.js';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

const DOT_COLOR: Record<ConnectionStatus, string> = {
  connecting: 'bg-amber-400',
  open: 'bg-emerald-400',
  reconnecting: 'bg-amber-400',
  closed: 'bg-red-500',
};

export function ConnectionBadge(): JSX.Element {
  const status = useWorldStore((s) => s.connectionStatus);
  return (
    <div className="flex items-center gap-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white">
      <span className={`h-2 w-2 rounded-full ${DOT_COLOR[status]}`} />
      {LABEL[status]}
    </div>
  );
}
