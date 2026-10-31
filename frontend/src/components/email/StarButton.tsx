import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import type { Email } from '../../types/api';
import { IconButton } from '../ui/IconButton';
import { StarIcon } from '../ui/icons';

/** Optimistically toggles the star, reverting on failure. */
export function StarButton({ email, onChange }: { email: Email; onChange: (updated: Email) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !email.starred;
    onChange({ ...email, starred: next });
    setPending(true);
    try {
      await api.setStarred(email.id, next);
    } catch (err) {
      onChange({ ...email, starred: !next });
      toast.error(err instanceof Error ? err.message : 'Could not update star');
    } finally {
      setPending(false);
    }
  };

  return (
    <IconButton label={email.starred ? 'Unstar' : 'Star'} onClick={toggle} disabled={pending}>
      <StarIcon size={17} className={email.starred ? 'fill-amber-400 text-amber-400' : 'text-[#c5c5c5]'} />
    </IconButton>
  );
}
