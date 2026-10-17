import { useEffect, useState, type FormEvent } from 'react';
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, type IncidentType, type SafetyAlertDto } from '@transaxis/shared';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors } from '../../lib/forms';
import { titleCase } from '../../lib/format';
import { useSafetyMutations } from './api';
import { ALERT_TYPE_LABEL, INCIDENT_TYPE_LABEL } from './badges';

const INCIDENT_FOR: Partial<Record<SafetyAlertDto['alertType'], IncidentType>> = {
  sos: 'sos',
  route_deviation: 'theft',
  geofence_breach: 'other',
  unexpected_stop: 'breakdown',
};

/** Acknowledge, resolve or raise an incident from an alert. */
export function AlertActions({ alert, compact }: { alert: SafetyAlertDto; compact?: boolean }) {
  const { can } = useAuth();
  const { ackAlert, resolveAlert } = useSafetyMutations();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'resolve' | 'incident'>(null);
  if (alert.status === 'resolved') return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {can('alerts:manage') && alert.status === 'open' && (
        <Button
          size="sm"
          loading={ackAlert.isPending}
          onClick={async () => {
            try {
              await ackAlert.mutateAsync({ id: alert.id });
              toast.success('Acknowledged');
            } catch (err) {
              toast.error(apiFieldErrors(err).message);
            }
          }}
        >
          Acknowledge
        </Button>
      )}
      {can('alerts:manage') && <Button size="sm" variant={compact ? 'ghost' : 'secondary'} onClick={() => setDialog('resolve')}>Resolve</Button>}
      {can('incidents:manage') && !alert.incidentId && <Button size="sm" variant="ghost" onClick={() => setDialog('incident')}>Raise incident</Button>}
      <ReasonDialog
        open={dialog === 'resolve'}
        onClose={() => setDialog(null)}
        title={`Resolve: ${alert.title}`}
        description="Record what was done, e.g. who was called and what they said."
        confirmLabel="Resolve alert"
        onConfirm={async (note) => {
          await resolveAlert.mutateAsync({ id: alert.id, note });
          toast.success('Alert resolved');
        }}
      />
      {dialog === 'incident' && <IncidentDialog open onClose={() => setDialog(null)} alert={alert} />}
    </span>
  );
}

/** Report an incident, optionally prefilled from an alert or a trip. */
export function IncidentDialog({ open, onClose, alert, tripId, stayOnPage }: { open: boolean; onClose: () => void; alert?: SafetyAlertDto; tripId?: number; stayOnPage?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { createIncident } = useSafetyMutations();
  const initial = () => ({
    incidentType: (alert ? (INCIDENT_FOR[alert.alertType] ?? 'other') : 'breakdown') as string,
    severity: alert?.severity === 'critical' ? 'high' : 'medium',
    title: alert ? `${ALERT_TYPE_LABEL[alert.alertType]}${alert.trip ? ` on ${alert.trip.tripNo}` : ''}` : '',
    description: alert?.detail ?? '',
    locationText: '',
  });
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(initial());
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 3) return setError('Give the incident a short title');
    try {
      const inc = await createIncident.mutateAsync({
        ...form,
        description: form.description || null,
        locationText: form.locationText || null,
        tripId: alert?.trip?.id ?? tripId ?? null,
        vehicleId: alert?.vehicle?.id ?? null,
        driverId: alert?.driver?.id ?? null,
        lat: alert?.lat ?? null,
        lng: alert?.lng ?? null,
        alertId: alert?.id,
      });
      toast.success(stayOnPage ? `${inc.incidentNo} reported to the control room` : `${inc.incidentNo} opened`);
      onClose();
      if (!stayOnPage) navigate(`/incidents/${inc.id}`);
    } catch (err) {
      setError(apiFieldErrors(err).message);
    }
  }
  const set = (k: keyof ReturnType<typeof initial>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={alert ? 'Raise an incident from this alert' : 'Report an incident'}
      description="Incidents track the response until it is resolved. Everyone with incident access is notified."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="incident-form" loading={createIncident.isPending}>Open incident</Button></>}
    >
      <form id="incident-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{error}</div>}
        <Field label="Type" required>
          {(p) => <Select {...p} value={form.incidentType} onChange={set('incidentType')}>{INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}</Select>}
        </Field>
        <Field label="Severity" required>
          {(p) => <Select {...p} value={form.severity} onChange={set('severity')}>{INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
        </Field>
        <Field label="Title" required className="sm:col-span-2">{(p) => <Input {...p} value={form.title} onChange={set('title')} maxLength={160} />}</Field>
        <Field label="What happened" className="sm:col-span-2">{(p) => <Textarea {...p} value={form.description} onChange={set('description')} />}</Field>
        <Field label="Location" hint="Landmark, highway km marker or town" className="sm:col-span-2">{(p) => <Input {...p} value={form.locationText} onChange={set('locationText')} />}</Field>
      </form>
    </Dialog>
  );
}
