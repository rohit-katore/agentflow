const LABELS: Record<string, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  waiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
}

export default function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>
}
