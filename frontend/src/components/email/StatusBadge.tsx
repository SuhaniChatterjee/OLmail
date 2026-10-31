import { formatBadgeTime } from '../../lib/format';
import type { Email } from '../../types/api';
import { Badge } from '../ui/Badge';
import { ClockIcon } from '../ui/icons';

export function StatusBadge({ email }: { email: Pick<Email, 'status' | 'scheduledAt'> }) {
  switch (email.status) {
    case 'scheduled':
      return <Badge tone="orange" icon={<ClockIcon size={12} />}>{formatBadgeTime(email.scheduledAt)}</Badge>;
    case 'sending':
      return <Badge tone="blue">Sending</Badge>;
    case 'sent':
      return <Badge tone="gray">Sent</Badge>;
    case 'failed':
      return <Badge tone="red">Failed</Badge>;
  }
}
