import type { TripAction, TripEventType } from '@transaxis/shared';
import type { TimelineItem } from '../../components/ui/Timeline';

export const EVENT_LABEL: Record<TripEventType, string> = {
  created: 'Trip planned',
  assigned: 'Crew assigned',
  reassigned: 'Assignment changed',
  inspection_passed: 'Inspection passed',
  inspection_failed: 'Inspection failed',
  dispatched: 'Dispatched',
  loading_started: 'Loading started',
  loading_completed: 'Loading completed',
  checkpoint: 'Checkpoint',
  arrived_stop: 'Arrived at stop',
  departed_stop: 'Departed stop',
  unloading_started: 'Unloading started',
  unloading_completed: 'Unloading completed',
  delay_reported: 'Delay reported',
  otp_issued: 'OTP issued',
  otp_failed: 'Wrong OTP entered',
  delivered: 'Delivered',
  completed: 'Completed',
  on_hold: 'Put on hold',
  resumed: 'Resumed',
  cancelled: 'Cancelled',
  reconciled: 'Reconciled',
  closed: 'Closed',
  note: 'Note',
};

export const EVENT_TONE: Partial<Record<TripEventType, NonNullable<TimelineItem['tone']>>> = {
  inspection_passed: 'ok',
  inspection_failed: 'crit',
  dispatched: 'info',
  delivered: 'ok',
  completed: 'ok',
  delay_reported: 'warn',
  otp_failed: 'warn',
  on_hold: 'warn',
  cancelled: 'crit',
};

export const ACTION_LABEL: Record<TripAction, string> = {
  mark_ready: 'Mark ready',
  dispatch: 'Dispatch',
  deliver: 'Record delivery',
  complete: 'Complete',
  reconcile: 'Reconcile',
  close: 'Close',
  hold: 'Hold',
  resume: 'Resume',
  cancel: 'Cancel trip',
};
