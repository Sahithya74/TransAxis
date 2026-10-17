import { useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@transaxis/shared';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, ErrorState, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors } from '../../lib/forms';
import { titleCase } from '../../lib/format';
import { useAttendance, useWorkerMutations } from './api';

/** One row per active worker for a day; only changed rows are saved. */
export function AttendancePanel({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const day = useAttendance(date);
  const [draft, setDraft] = useState<Record<number, AttendanceStatus | ''>>({});
  const { saveAttendance } = useWorkerMutations();
  const toast = useToast();

  useEffect(() => setDraft({}), [date]);
  const changed = useMemo(
    () => Object.entries(draft).filter(([id, s]) => s && s !== day.data?.find((r) => r.worker.id === Number(id))?.status),
    [draft, day.data],
  );

  const save = async () => {
    try {
      await saveAttendance.mutateAsync({ workDate: date, entries: changed.map(([id, status]) => ({ workerId: Number(id), status: status as string })) });
      toast.success(`Saved ${changed.length} attendance entr${changed.length === 1 ? 'y' : 'ies'}`);
      setDraft({});
    } catch (err) {
      toast.error(apiFieldErrors(err).message);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Input aria-label="Date" type="date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="flex-1 text-xs text-muted">{changed.length ? `${changed.length} unsaved change(s)` : 'Mark each person for the day.'}</span>
        <Button size="sm" variant="primary" disabled={!changed.length} loading={saveAttendance.isPending} onClick={() => void save()}>
          Save attendance
        </Button>
      </div>
      {day.isError ? (
        <ErrorState message={(day.error as Error).message} />
      ) : day.isPending ? (
        <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
      ) : (
        <Table minWidth={560}>
          <THead>
            <Th>Worker</Th>
            <Th>Role</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {day.data.map((r) => (
              <tr key={r.worker.id} className="border-b border-subtle">
                <td className="h-11 px-4">
                  <div className="font-medium">{r.worker.fullName}</div>
                  <div className="text-xs text-muted">{r.worker.employeeCode}</div>
                </td>
                <td className="px-4">{titleCase(r.worker.workerType)}</td>
                <td className="px-4">
                  <Select
                    aria-label={`Attendance for ${r.worker.fullName}`}
                    className="w-40"
                    value={draft[r.worker.id] ?? r.status ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.worker.id]: e.target.value as AttendanceStatus }))}
                  >
                    <option value="">Not marked</option>
                    {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
