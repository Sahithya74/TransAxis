import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/ui/Toast';
import { getAccessToken, refreshSession } from './api';

export interface LivePosition {
  vehicleId: number;
  tripId: number;
  lat: number;
  lng: number;
  speedKmph: number | null;
  headingDeg: number | null;
  recordedAt: string;
  isSimulated: boolean;
}

interface RealtimeState {
  connected: boolean;
  socket: Socket | null;
}

const RealtimeContext = createContext<RealtimeState>({ connected: false, socket: null });

/**
 * One Socket.IO connection per signed-in tab. The server only delivers events the user may see; here
 * they refresh the matching cached queries, and important notifications also show a toast. If the
 * socket can't connect, pages keep working on their normal refresh intervals.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [state, setState] = useState<RealtimeState>({ connected: false, socket: null });

  useEffect(() => {
    if (status !== 'authenticated') return;
    // The auth callback runs on every (re)connection, so a refreshed token is always used.
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: (cb) => cb({ token: getAccessToken() }) });
    socket.on('connect', () => setState({ connected: true, socket }));
    socket.on('disconnect', () => setState({ connected: false, socket }));
    socket.on('connect_error', async (err) => {
      if (err.message === 'unauthenticated' && (await refreshSession())) socket.connect();
    });
    socket.on('positions', (positions: LivePosition[]) => {
      qc.setQueryData(['tracking', 'positions'], (prev: Map<number, LivePosition> | undefined) => {
        const next = new Map(prev);
        for (const p of positions) next.set(p.vehicleId, p);
        return next;
      });
    });
    socket.on('alert', () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['tracking', 'summary'] });
    });
    socket.on('incident', () => {
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      void qc.invalidateQueries({ queryKey: ['tracking', 'summary'] });
    });
    socket.on('notification', (n: { title: string; priority: string }) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.priority === 'critical') toastRef.current.error(n.title);
    });
    setState({ connected: false, socket });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setState({ connected: false, socket: null });
    };
  }, [status, user?.id, qc]);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
