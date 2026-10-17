import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, OctagonX, Search, TriangleAlert } from 'lucide-react';
import type { BookingListItemDto, CandidateDto, TripDto, Violation } from '@transaxis/shared';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors } from '../../lib/forms';
import { fmtWeight, fromLocalInput, toLocalInput } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { checkAssignment, useCandidates, useTripMutations } from './api';

type Props = { open: boolean; onClose: () => void } & ({ booking: BookingListItemDto; trip?: undefined } | { trip: TripDto; booking?: undefined });

/**
 * Assign a vehicle, driver and helpers to a booking (new trip) or change an existing trip's assignment.
 * Candidates come ranked by how cleanly they fit; the final combination is checked by the same rules
 * the API enforces, and warnings can only be overridden with a written reason by permitted roles.
 */
export function PlanTripDrawer(props: Props) {
  const { open, onClose, booking, trip } = props;
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const toast = useToast();
  const { create, reassign } = useTripMutations();

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [driverId, setDriverId] = useState<number | null>(null);
  const [helpers, setHelpers] = useState<number[]>([]);
  const [override, setOverride] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStart(toLocalInput(trip?.plannedStart ?? booking?.loadingWindowStart, tz));
    setEnd(toLocalInput(trip?.plannedEnd ?? booking?.deliveryDeadline, tz));
    setVehicleId(trip?.vehicle.id ?? null);
    setDriverId(trip?.driver.id ?? null);
    setHelpers(trip?.crew.filter((c) => c.role === 'helper').map((c) => c.workerId) ?? []);
    setOverride('');
    setNote('');
    setError(null);
  }, [open, trip, booking, tz]);

  const plannedStart = start ? fromLocalInput(start, tz) : '';
  const plannedEnd = end ? fromLocalInput(end, tz) : '';
  const windowOk = !!plannedStart && !!plannedEnd && Date.parse(plannedEnd) > Date.parse(plannedStart);
  const bookingId = booking?.id ?? trip?.booking?.id;
  const tripId = trip?.id;
  const candidates = useCandidates(windowOk ? { plannedStart, plannedEnd, bookingId, tripId, vehicleId: vehicleId ?? undefined } : null);

  const payload = useMemo(
    () =>
      windowOk && vehicleId && driverId
        ? { bookingId: bookingId ?? null, tripId, vehicleId, driverId, crew: helpers.map((workerId) => ({ workerId, role: 'helper' as const })), plannedStart, plannedEnd }
        : null,
    [windowOk, vehicleId, driverId, helpers, bookingId, tripId, plannedStart, plannedEnd],
  );
  const check = useQuery({ queryKey: ['trips', 'check', payload], queryFn: () => checkAssignment(payload), enabled: !!payload, staleTime: 5_000 });
  const blocks = check.data?.blocks ?? [];
  const warnings = check.data?.warnings ?? [];
  const needsOverride = warnings.length > 0;
  const canSubmit = !!payload && check.isSuccess && blocks.length === 0 && (!needsOverride || (check.data.canOverride && override.trim().length >= 10));

  async function submit() {
    if (!payload) return;
    setError(null);
    const base = { vehicleId, driverId, crew: payload.crew, plannedStart: payload.plannedStart, plannedEnd: payload.plannedEnd, overrideReason: needsOverride ? override.trim() : undefined };
    try {
      if (trip) {
        await reassign.mutateAsync({ id: trip.id, body: { ...base, reason: note.trim() || undefined } });
        toast.success(`${trip.tripNo} reassigned`);
        onClose();
      } else {
        const created = await create.mutateAsync({ ...base, bookingId: booking!.id, tripType: 'loaded', notes: note.trim() || undefined });
        toast.success(`Trip ${created.tripNo} planned. Next: pre-trip inspection.`);
        onClose();
        navigate(`/trips/${created.id}`);
      }
    } catch (err) {
      setError(apiFieldErrors(err).message);
      void check.refetch();
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={trip ? `Reassign ${trip.tripNo}` : `Plan a trip for ${booking!.bookingNo}`}
      description={booking ? `${booking.customer.name} · ${booking.originCity} → ${booking.destinationCity} · ${fmtWeight(booking.totalWeightKg)}` : `${trip!.originCity} → ${trip!.destinationCity}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} loading={create.isPending || reassign.isPending}>
            {trip ? 'Save assignment' : 'Create trip'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">{error}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Planned start" required>{(p) => <Input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Planned end" required error={start && end && !windowOk ? 'Must be after the start' : undefined}>
            {(p) => <Input {...p} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />}
          </Field>
        </div>

        <CandidatePicker
          title="Vehicle"
          loading={candidates.isPending && windowOk}
          items={candidates.data?.vehicles}
          selected={vehicleId ? [vehicleId] : []}
          onToggle={(id) => setVehicleId(id)}
        />
        <CandidatePicker
          title="Driver"
          hint={vehicleId ? 'Ranked for the selected vehicle (licence class, rest, leave and clashes).' : 'Pick a vehicle first for an exact licence check.'}
          loading={candidates.isPending && windowOk}
          items={candidates.data?.drivers}
          selected={driverId ? [driverId] : []}
          onToggle={(id) => setDriverId(id)}
        />
        <CandidatePicker
          title="Helpers (optional, up to 3)"
          loading={candidates.isPending && windowOk}
          items={candidates.data?.helpers}
          selected={helpers}
          multi
          onToggle={(id) => setHelpers((h) => (h.includes(id) ? h.filter((x) => x !== id) : h.length < 3 ? [...h, id] : h))}
        />

        <section aria-live="polite" className="rounded border border-line p-3">
          <h3 className="mb-2 text-[13px] font-semibold">Assignment check</h3>
          {!payload ? (
            <p className="text-[13px] text-muted">Choose a vehicle and driver to check the combination.</p>
          ) : check.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : check.isError ? (
            <p className="text-[13px] text-crit-strong">{(check.error as Error).message}</p>
          ) : blocks.length === 0 && warnings.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-ok-strong"><CheckCircle2 className="size-4" aria-hidden /> All rules pass for this window.</p>
          ) : (
            <ViolationList blocks={blocks} warnings={warnings} />
          )}
        </section>

        {needsOverride && blocks.length === 0 && (
          check.data?.canOverride ? (
            <Field label="Why proceed despite the warnings?" required hint="At least 10 characters. Saved on the trip and in the audit log.">
              {(p) => <Textarea {...p} value={override} onChange={(e) => setOverride(e.target.value)} maxLength={255} />}
            </Field>
          ) : (
            <p className="text-[13px] text-warn-strong">Your role can’t override warnings. Pick another vehicle or driver, or ask a dispatcher.</p>
          )
        )}

        <Field label={trip ? 'Reason for the change (optional)' : 'Notes for the crew (optional)'}>
          {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={trip ? 255 : 2000} />}
        </Field>
      </div>
    </Drawer>
  );
}

export function ViolationList({ blocks, warnings }: { blocks: Violation[]; warnings: Violation[] }) {
  return (
    <ul className="space-y-1.5 text-[13px]">
      {blocks.map((v, i) => (
        <li key={`b${i}`} className="flex items-start gap-2 text-crit-strong">
          <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><span className="sr-only">Blocks: </span>{v.message}</span>
        </li>
      ))}
      {warnings.map((v, i) => (
        <li key={`w${i}`} className="flex items-start gap-2 text-warn-strong">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><span className="sr-only">Warning: </span>{v.message}</span>
        </li>
      ))}
    </ul>
  );
}

function CandidatePicker({
  title,
  hint,
  items,
  selected,
  multi,
  loading,
  onToggle,
}: {
  title: string;
  hint?: string;
  items: CandidateDto[] | undefined;
  selected: number[];
  multi?: boolean;
  loading: boolean;
  onToggle: (id: number) => void;
}) {
  const [filter, setFilter] = useState('');
  const shown = (items ?? []).filter((c) => !filter || `${c.label} ${c.detail}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-semibold">{title}</legend>
      {hint && <p className="mb-1.5 text-xs text-muted">{hint}</p>}
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
        <Input aria-label={`Filter ${title.toLowerCase()}`} placeholder="Filter…" className="pl-8" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="max-h-56 overflow-y-auto rounded border border-line">
        {loading ? (
          <div className="space-y-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !items ? (
          <p className="p-3 text-[13px] text-muted">Set a valid time window to see who is available.</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-[13px] text-muted">No matches.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((c) => {
              const on = selected.includes(c.id);
              const blocked = c.blocks.length > 0;
              return (
                <li key={c.id}>
                  <label className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-[13px] ${on ? 'bg-primary-soft' : 'hover:bg-canvas'}`}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={title}
                      className="mt-1"
                      checked={on}
                      onChange={() => onToggle(c.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.label}</span>
                        {blocked ? (
                          <span className="text-xs font-medium text-crit-strong">Not eligible</span>
                        ) : c.warnings.length ? (
                          <span className="text-xs font-medium text-warn-strong">{c.warnings.length} warning{c.warnings.length > 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-xs font-medium text-ok-strong">Fits</span>
                        )}
                      </span>
                      <span className="block text-xs text-muted">{c.detail}</span>
                      {(blocked || c.warnings.length > 0) && (
                        <span className={`mt-0.5 block text-xs ${blocked ? 'text-crit-strong' : 'text-warn-strong'}`}>
                          {[...c.blocks, ...c.warnings].map((v) => v.message).slice(0, 2).join(' · ')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
