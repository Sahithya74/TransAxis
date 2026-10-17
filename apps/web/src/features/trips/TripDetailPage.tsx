import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Check, ChevronLeft, Download, Flag, Printer, Users } from 'lucide-react';
import type { TripAction, TripDto, TripStatus } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { BookingStatusBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Badge } from '../../components/ui/Badge';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Timeline } from '../../components/ui/Timeline';
import { useToast } from '../../components/ui/Toast';
import { ApiError, downloadFile } from '../../lib/api';
import { fmtDateTime, fmtNumber, fmtRelative, fmtWeight, titleCase } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { TripTrackingCard } from '../live/TripTrackingCard';
import { useBackhaul, useTrip, useTripMutations } from './api';
import { EVENT_LABEL, EVENT_TONE } from './labels';
import { PlanTripDrawer } from './PlanTripDrawer';
import { CompleteDialog, DeliverDialog, DispatchDialog, InspectionDialog, MilestoneDialog, ReissueOtpDialog } from './TripDialogs';

const STEPS: TripStatus[] = ['planned', 'ready', 'in_transit', 'delivered', 'completed', 'reconciled', 'closed'];
const STEP_LABEL: Record<string, string> = {
  planned: 'Planned',
  ready: 'Inspected',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  reconciled: 'Reconciled',
  closed: 'Closed',
};

type DialogId =
  | 'pre_trip'
  | 'post_trip'
  | 'dispatch'
  | 'deliver'
  | 'otp'
  | 'complete'
  | 'milestone'
  | 'reassign'
  | Extract<TripAction, 'hold' | 'resume' | 'cancel' | 'reconcile' | 'close' | 'mark_ready'>;

export function TripDetailPage() {
  const id = Number(useParams().id);
  const q = useTrip(id);
  const { can, user } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const { act } = useTripMutations();
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const t = q.data;
  const backhaul = useBackhaul(id, !!t && can('trips:read') && ['in_transit', 'delivered'].includes(t.status));

  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        {nf ? <EmptyState title="Trip not found" action={<Link className="text-primary hover:underline" to="/trips">Back to trips</Link>} /> : <ErrorState message={(q.error as Error).message} />}
      </Card>
    );
  }

  // A crew member holding only trips:update_own acts on their own trips (the API enforces this too).
  const isCrew = !!t && !can('trips:read') && !!user;
  const crewOrDispatch = can('trips:dispatch') || isCrew;
  const has = (a: TripAction) => !!t?.availableActions.includes(a);
  const lastPreTrip = t?.inspections.find((i) => i.inspectionType === 'pre_trip');
  const reassignable = !!t && can('trips:assign') && (t.status === 'planned' || t.status === 'ready' || (t.status === 'on_hold' && t.holdFromStatus !== 'in_transit'));

  const simple = async (action: TripAction, reason: string) => {
    await act.mutateAsync({ id, body: { action, reason: reason || undefined, version: t!.version } });
    toast.success(`${t!.tripNo}: ${titleCase(action)} done`);
  };

  return (
    <div>
      <Link to="/trips" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Trips
      </Link>
      <PageHeader
        title={t ? <span className="font-mono">{t.tripNo}</span> : <Skeleton className="h-7 w-56" />}
        subtitle={t && (
          <span className="flex flex-wrap items-center gap-2">
            <TripStatusBadge status={t.status} />
            <span>{t.originCity} → {t.destinationCity}</span>
            {t.tripType !== 'loaded' && <Badge tone="neutral">{titleCase(t.tripType)} run</Badge>}
            {t.booking && (
              <Link to={`/bookings/${t.booking.id}`} className="text-primary hover:underline">
                {t.booking.bookingNo}{t.booking.lrNumber ? ` · LR ${t.booking.lrNumber}` : ''}
              </Link>
            )}
          </span>
        )}
        actions={t && (
          <>
            {(t.status === 'planned' || t.status === 'ready') && crewOrDispatch && (
              <Button variant={t.status === 'planned' ? 'primary' : 'secondary'} onClick={() => setDialog('pre_trip')}>Pre-trip inspection</Button>
            )}
            {has('mark_ready') && lastPreTrip?.result === 'pass' && <Button onClick={() => setDialog('mark_ready')}>Mark ready</Button>}
            {has('dispatch') && <Button variant="primary" onClick={() => setDialog('dispatch')}>Dispatch</Button>}
            {t.status === 'in_transit' && t.podStatus === 'pending' && crewOrDispatch && <Button variant="primary" onClick={() => setDialog('deliver')}>Record delivery</Button>}
            {t.status === 'in_transit' && t.podStatus === 'pending' && can('trips:dispatch') && <Button onClick={() => setDialog('otp')}>Reissue OTP</Button>}
            {has('complete') && <Button variant="primary" onClick={() => setDialog('complete')}>Complete</Button>}
            {(t.status === 'delivered' || t.status === 'completed') && crewOrDispatch && <Button onClick={() => setDialog('post_trip')}>Post-trip inspection</Button>}
            {has('reconcile') && <Button variant="primary" onClick={() => setDialog('reconcile')}>Reconcile</Button>}
            {has('close') && <Button onClick={() => setDialog('close')}>Close</Button>}
            {['ready', 'in_transit', 'delivered'].includes(t.status) && crewOrDispatch && <Button onClick={() => setDialog('milestone')}><Flag className="size-4" aria-hidden /> Milestone</Button>}
            {reassignable && <Button onClick={() => setDialog('reassign')}><Users className="size-4" aria-hidden /> Reassign</Button>}
            {has('resume') && <Button onClick={() => setDialog('resume')}>Resume</Button>}
            {has('hold') && <Button onClick={() => setDialog('hold')}>Hold</Button>}
            {has('cancel') && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel</Button>}
            <Button onClick={() => window.open(`/print/trip/${id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> Trip sheet</Button>
          </>
        )}
      />

      {t?.status === 'on_hold' && <Banner tone="warn" title={`On hold (was ${titleCase(t.holdFromStatus ?? '')})`}>{t.holdReason}</Banner>}
      {t?.status === 'cancelled' && <Banner tone="crit" title="Cancelled">{t.cancelReason}</Banner>}
      {t?.overrideReason && <Banner tone="info" title="Rule warnings were overridden">{t.overrideReason}</Banner>}

      {!t ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Progress trip={t} />
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              {can('tracking:read') && ['in_transit', 'delivered', 'completed', 'on_hold'].includes(t.status) && t.actualStart && (
                <TripTrackingCard tripId={t.id} vehicleId={t.vehicle.id} />
              )}
              <Card>
                <div className="border-b border-line px-5 py-3"><h2 className="text-base">Stops</h2></div>
                <ol className="divide-y divide-line">
                  {t.stops.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 px-5 py-3 text-[13px]">
                      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.status === 'departed' || s.status === 'arrived' ? 'bg-ok text-white' : 'bg-subtle text-muted'}`}>
                        {s.status === 'departed' || s.status === 'arrived' ? <Check className="size-3.5" aria-hidden /> : s.seq}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{s.name} <span className="ml-1 text-xs font-normal uppercase text-muted">{s.stopType}</span></div>
                        <div className="text-muted">{[s.addressLine, s.city].filter(Boolean).join(', ')}</div>
                        {(s.contactName || s.contactPhone) && <div className="text-muted">{[s.contactName, s.contactPhone].filter(Boolean).join(' · ')}</div>}
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted">
                        {s.actualArrival && <div>Arrived {fmtDateTime(s.actualArrival, tz)}</div>}
                        {s.actualDeparture && <div>Left {fmtDateTime(s.actualDeparture, tz)}</div>}
                        {!s.actualArrival && !s.actualDeparture && s.plannedArrival && <div>Due {fmtDateTime(s.plannedArrival, tz)}</div>}
                        <div className="capitalize">{s.status}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card>
                <div className="flex items-center justify-between border-b border-line px-5 py-3">
                  <h2 className="text-base">Activity</h2>
                  <span className="text-xs text-muted">{t.events.length} events</span>
                </div>
                <div className="px-5 py-4">
                  {t.events.length === 0 ? (
                    <p className="text-[13px] text-muted">Nothing recorded yet.</p>
                  ) : (
                    <Timeline
                      items={t.events.map((e) => ({
                        id: e.id,
                        tone: EVENT_TONE[e.eventType] ?? 'default',
                        title: (
                          <span className="flex flex-wrap items-center gap-2">
                            {EVENT_LABEL[e.eventType]}
                            {e.source === 'driver_app' && <Badge tone="info">Driver app</Badge>}
                            {e.source === 'simulated' && <Badge tone="neutral">Simulated</Badge>}
                          </span>
                        ),
                        meta: `${fmtDateTime(e.occurredAt, tz)} · ${fmtRelative(e.occurredAt)}${e.recordedBy ? ` · ${e.recordedBy}` : ''}${e.odometer != null ? ` · ${fmtNumber(e.odometer)} km` : ''}`,
                        body: e.note,
                      }))}
                    />
                  )}
                </div>
              </Card>

              {t.pod && (
                <Card className="p-5">
                  <h2 className="mb-3 text-base">Proof of delivery</h2>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
                    <Item label="Method">{t.pod.method === 'otp' ? <Badge tone="ok">Consignee OTP</Badge> : <Badge tone="warn">Authorised override</Badge>}</Item>
                    <Item label="Received by">{t.pod.recipientName}{t.pod.recipientPhone && <span className="block text-xs font-normal text-muted">{t.pod.recipientPhone}</span>}</Item>
                    <Item label="Delivered">{fmtDateTime(t.pod.deliveredAt, tz)}</Item>
                    <Item label="Condition">
                      {t.pod.damageReported || t.pod.shortageReported ? (
                        <span className="text-crit-strong">{[t.pod.damageReported && 'Damage', t.pod.shortageReported && 'Shortage'].filter(Boolean).join(' and ')} reported</span>
                      ) : 'No issues reported'}
                    </Item>
                    <Item label="Recorded by">{t.pod.recordedBy ?? '—'}</Item>
                    {t.pod.overrideReason && <Item label="Override reason" wide>{t.pod.overrideReason}</Item>}
                    {t.pod.remarks && <Item label="Remarks" wide>{t.pod.remarks}</Item>}
                  </dl>
                  {t.pod.photoFileIds.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.pod.photoFileIds.map((f, i) => (
                        <Button key={f} size="sm" onClick={() => void downloadFile(f, `${t.tripNo}-pod-${i + 1}`)}>
                          <Download className="size-3.5" aria-hidden /> Photo {i + 1}
                        </Button>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              <Card>
                <div className="border-b border-line px-5 py-3"><h2 className="text-base">Inspections</h2></div>
                {t.inspections.length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-muted">No inspections yet. A passed pre-trip inspection is required before dispatch.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {t.inspections.map((i) => {
                      const failed = i.items.filter((x) => x.result === 'fail');
                      return (
                        <li key={i.id} className="px-5 py-3 text-[13px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{i.inspectionType === 'pre_trip' ? 'Pre-trip' : 'Post-trip'}</span>
                            <Badge tone={i.result === 'pass' ? 'ok' : 'crit'}>{i.result === 'pass' ? 'Passed' : 'Failed'}</Badge>
                            <span className="text-muted">{fmtDateTime(i.inspectedAt, tz)}{i.inspectedBy ? ` · ${i.inspectedBy}` : ''}{i.odometer != null ? ` · ${fmtNumber(i.odometer)} km` : ''}</span>
                          </div>
                          {failed.length > 0 && (
                            <ul className="mt-1.5 list-disc pl-5 text-crit-strong">
                              {failed.map((x) => <li key={x.key}>{x.label}{x.critical ? ' (critical)' : ''}{x.note ? `: ${x.note}` : ''}</li>)}
                            </ul>
                          )}
                          {i.notes && <p className="mt-1 text-muted">{i.notes}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="p-5">
                <h2 className="mb-3 text-base">Assignment</h2>
                <dl className="space-y-3 text-[13px]">
                  <Item label="Vehicle">
                    <Link to={`/vehicles/${t.vehicle.id}`} className="font-mono text-primary hover:underline">{t.vehicle.registrationNo}</Link>
                    <span className="block text-xs font-normal text-muted">{t.vehicle.vehicleType} · {fmtWeight(t.vehicle.payloadCapacityKg)} payload · needs {t.vehicle.requiredLicenceClass}</span>
                  </Item>
                  <Item label="Driver">
                    <Link to={`/workers/${t.driver.id}`} className="text-primary hover:underline">{t.driver.fullName}</Link>
                    <span className="block text-xs font-normal text-muted">{t.driver.phone}</span>
                  </Item>
                  {t.crew.length > 0 && (
                    <Item label="Crew">
                      {t.crew.map((c) => (
                        <span key={c.workerId} className="block">
                          <Link to={`/workers/${c.workerId}`} className="text-primary hover:underline">{c.fullName}</Link>
                          <span className="text-xs font-normal text-muted"> · {titleCase(c.role)} · {c.phone}</span>
                        </span>
                      ))}
                    </Item>
                  )}
                  <Item label="Cargo">{fmtWeight(t.cargoWeightKg)}{t.vehicle.payloadCapacityKg ? <span className="text-xs font-normal text-muted"> · {Math.round((t.cargoWeightKg / t.vehicle.payloadCapacityKg) * 100)}% of payload</span> : null}</Item>
                </dl>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-base">Schedule</h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                  <Item label="Planned start">{fmtDateTime(t.plannedStart, tz)}</Item>
                  <Item label="Planned end">{fmtDateTime(t.plannedEnd, tz)}</Item>
                  <Item label="Started">{fmtDateTime(t.actualStart, tz)}</Item>
                  <Item label="Delivered">{fmtDateTime(t.deliveredAt, tz)}</Item>
                  <Item label="Completed">{fmtDateTime(t.completedAt, tz)}</Item>
                  <Item label="Route">{t.route ? `${t.route.name}` : '—'}</Item>
                  <Item label="Planned distance">{t.plannedDistanceKm != null ? `${fmtNumber(t.plannedDistanceKm)} km` : '—'}</Item>
                  <Item label="Odometer">
                    {t.startOdometer != null ? `${fmtNumber(t.startOdometer)}${t.endOdometer != null ? ` → ${fmtNumber(t.endOdometer)}` : ''} km` : '—'}
                    {t.startOdometer != null && t.endOdometer != null && <span className="block text-xs font-normal text-muted">{fmtNumber(t.endOdometer - t.startOdometer)} km run</span>}
                  </Item>
                  <Item label="Proof of delivery">
                    {t.podStatus === 'pending' ? (t.otpActive ? <Badge tone="info">OTP issued</Badge> : t.status === 'in_transit' ? <Badge tone="warn">No active OTP</Badge> : 'Pending') : t.podStatus === 'not_required' ? 'Not required' : titleCase(t.podStatus)}
                  </Item>
                </dl>
                {t.notes && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px] text-muted">{t.notes}</p>}
              </Card>

              {t.seals.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-2 text-base">Cargo seals</h2>
                  <ul className="space-y-1.5 text-[13px]">
                    {t.seals.map((s) => (
                      <li key={s.sealNo} className="flex items-center justify-between">
                        <span className="font-mono">{s.sealNo}</span>
                        {s.intact === null ? <span className="text-xs text-muted">applied {fmtDateTime(s.appliedAt, tz)}</span> : <Badge tone={s.intact ? 'ok' : 'crit'}>{s.intact ? 'Intact at delivery' : 'Broken'}</Badge>}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {backhaul.data && backhaul.data.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-1 text-base">Return loads near {t.destinationCity}</h2>
                  <p className="mb-3 text-xs text-muted">Approved bookings loading from {t.destinationCity} around this trip’s arrival. Planning one avoids an empty return.</p>
                  <ul className="space-y-2 text-[13px]">
                    {backhaul.data.map((b) => (
                      <li key={b.id}>
                        <Link to={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 rounded border border-line p-2 hover:bg-canvas">
                          <span>
                            <span className="font-mono text-primary">{b.bookingNo}</span>
                            <span className="block text-xs text-muted">{b.customer.name} · to {b.destinationCity} · {fmtWeight(b.totalWeightKg)}</span>
                          </span>
                          <span className="text-right text-xs text-muted">{fmtDateTime(b.loadingWindowStart, tz)}<br /><BookingStatusBadge status={b.status} /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="p-5">
                <h2 className="mb-3 text-base">Status history</h2>
                <Timeline
                  items={t.history
                    .slice()
                    .reverse()
                    .map((h, i) => ({
                      id: i,
                      title: `${h.fromStatus ? `${titleCase(h.fromStatus)} → ` : ''}${titleCase(h.toStatus)}`,
                      meta: `${fmtDateTime(h.at, tz)}${h.changedBy ? ` · ${h.changedBy}` : ''}`,
                      body: h.reason,
                    }))}
                />
              </Card>
            </div>
          </div>
        </>
      )}

      {t && (
        <>
          <InspectionDialog open={dialog === 'pre_trip'} onClose={() => setDialog(null)} trip={t} type="pre_trip" />
          <InspectionDialog open={dialog === 'post_trip'} onClose={() => setDialog(null)} trip={t} type="post_trip" />
          <DispatchDialog open={dialog === 'dispatch'} onClose={() => setDialog(null)} trip={t} />
          <DeliverDialog open={dialog === 'deliver'} onClose={() => setDialog(null)} trip={t} />
          <ReissueOtpDialog open={dialog === 'otp'} onClose={() => setDialog(null)} trip={t} />
          <CompleteDialog open={dialog === 'complete'} onClose={() => setDialog(null)} trip={t} />
          <MilestoneDialog open={dialog === 'milestone'} onClose={() => setDialog(null)} trip={t} />
          {dialog === 'reassign' && <PlanTripDrawer open onClose={() => setDialog(null)} trip={t} />}
          <ReasonDialog open={dialog === 'mark_ready'} onClose={() => setDialog(null)} title={`Mark ${t.tripNo} ready`} description="The last pre-trip inspection passed." confirmLabel="Mark ready" reasonRequired={false} onConfirm={(r) => simple('mark_ready', r)} />
          <ReasonDialog open={dialog === 'hold'} onClose={() => setDialog(null)} title={`Hold ${t.tripNo}`} description="The vehicle and crew stay reserved while the trip is on hold." confirmLabel="Put on hold" onConfirm={(r) => simple('hold', r)} />
          <ReasonDialog open={dialog === 'resume'} onClose={() => setDialog(null)} title={`Resume ${t.tripNo}`} description={`Returns the trip to ${titleCase(t.holdFromStatus ?? '')}.`} confirmLabel="Resume" reasonRequired={false} onConfirm={(r) => simple('resume', r)} />
          <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${t.tripNo}`} description="Releases the vehicle and crew. The booking goes back to the planning queue." confirmLabel="Cancel trip" danger onConfirm={(r) => simple('cancel', r)} />
          <ReasonDialog open={dialog === 'reconcile'} onClose={() => setDialog(null)} title={`Reconcile ${t.tripNo}`} description="Confirms the trip’s expenses, advances and cash have been checked." confirmLabel="Reconcile" reasonRequired={false} onConfirm={(r) => simple('reconcile', r)} />
          <ReasonDialog open={dialog === 'close'} onClose={() => setDialog(null)} title={`Close ${t.tripNo}`} description="Closed trips are final." confirmLabel="Close trip" reasonRequired={false} onConfirm={(r) => simple('close', r)} />
        </>
      )}
    </div>
  );
}

function Progress({ trip }: { trip: TripDto }) {
  const current = trip.status === 'on_hold' ? (trip.holdFromStatus ?? 'planned') : trip.status;
  const at = STEPS.indexOf(current);
  if (trip.status === 'cancelled') return null;
  return (
    <ol className="mb-5 flex overflow-x-auto rounded-lg border border-line bg-surface shadow-card" aria-label="Trip progress">
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && s === 'closed');
        const here = i === at && s !== 'closed';
        return (
          <li
            key={s}
            aria-current={here ? 'step' : undefined}
            className={`flex min-w-28 flex-1 items-center gap-2 border-r border-line px-3 py-2.5 text-[13px] last:border-r-0 ${here ? 'bg-primary-soft font-semibold text-primary-strong' : done ? 'text-ok-strong' : 'text-muted'}`}
          >
            <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${done ? 'bg-ok text-white' : here ? 'bg-primary text-white' : 'bg-subtle'}`}>
              {done ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            {STEP_LABEL[s]}
          </li>
        );
      })}
    </ol>
  );
}

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
