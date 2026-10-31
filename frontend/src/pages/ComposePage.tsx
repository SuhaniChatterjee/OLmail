import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RecipientField } from '../components/email/RecipientField';
import { RichTextEditor } from '../components/email/RichTextEditor';
import { SenderSelect } from '../components/email/SenderSelect';
import { SendLaterPopover } from '../components/email/SendLaterPopover';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { ArrowLeftIcon, ClockIcon } from '../components/ui/icons';
import { NumberBox } from '../components/ui/Input';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[42px] shrink-0 pt-1.5 text-sm text-ink">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [senderId, setSenderId] = useState<string>();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const validationError = (): string | null => {
    if (!senderId) return 'Choose a sender';
    if (!recipients.length) return 'Add at least one recipient';
    if (!subject.trim()) return 'Subject is required';
    if (!body) return 'Email body is empty';
    if (hourlyLimit && Number(hourlyLimit) < 1) return 'Hourly limit must be at least 1';
    return null;
  };

  const openScheduler = () => {
    const err = validationError();
    if (err) toast.error(err);
    else setScheduleOpen(true);
  };

  const schedule = async (when: Date) => {
    setSubmitting(true);
    try {
      const res = await api.schedule({
        subject: subject.trim(),
        body,
        recipients,
        startTime: when.toISOString(),
        delayBetweenSeconds: Number(delaySeconds) || 0,
        hourlyLimit: hourlyLimit ? Number(hourlyLimit) : undefined,
        senderId,
      });
      toast.success(`Scheduled ${res.count} email${res.count === 1 ? '' : 's'}`);
      navigate('/scheduled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not schedule emails');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center gap-3 px-4 py-4">
        <IconButton label="Back" onClick={() => navigate(-1)} className="text-ink">
          <ArrowLeftIcon size={20} />
        </IconButton>
        <h1 className="flex-1 text-xl text-ink">Compose New Email</h1>
        <div className="relative flex items-center gap-2">
          <IconButton label="Schedule" onClick={openScheduler} className="text-brand hover:text-brand-dark">
            <ClockIcon size={18} />
          </IconButton>
          <Button variant="outline" size="sm" onClick={openScheduler} loading={submitting}>
            Send Later
          </Button>
          <SendLaterPopover open={scheduleOpen} onClose={() => setScheduleOpen(false)} onConfirm={schedule} submitting={submitting} />
        </div>
      </header>

      <div className="mx-auto max-w-[875px] space-y-5 px-6 pb-16 pt-2">
        <FieldRow label="From">
          <SenderSelect value={senderId} onChange={setSenderId} />
        </FieldRow>

        <FieldRow label="To">
          <RecipientField value={recipients} onChange={setRecipients} />
        </FieldRow>

        <FieldRow label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={500}
            className="h-8 w-full border-b border-line bg-transparent pb-2 text-[15px] outline-none placeholder:text-muted/70 focus:border-brand"
          />
        </FieldRow>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink">
          <label className="flex items-center gap-3">
            Delay between 2 emails
            <NumberBox placeholder="00" value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} aria-label="Delay between emails in seconds" />
            <span className="-ml-1 text-xs text-muted">sec</span>
          </label>
          <label className="flex items-center gap-3">
            Hourly Limit
            <NumberBox placeholder="00" min={1} value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} aria-label="Hourly limit" />
          </label>
        </div>

        <RichTextEditor value={body} onChange={setBody} placeholder="Type Your Reply..." />
      </div>
    </div>
  );
}
