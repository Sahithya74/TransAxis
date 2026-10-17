import type { Server as HttpServer } from 'node:http';
import { decodeJwt } from 'jose';
import type { Logger } from 'pino';
import { Server } from 'socket.io';
import type { Permission } from '@transaxis/shared';
import { verifyAccessToken } from '../lib/tokens.js';

/**
 * Push channel to browsers. Sockets authenticate with the same short-lived access token as the REST
 * API and join one room per permission, so an event is only ever delivered to users allowed to read
 * the data it carries. Events are hints to refresh or small payloads; the REST API stays the source
 * of truth.
 */
export interface Realtime {
  toPermission(orgId: number, permission: Permission, event: string, payload: unknown): void;
  toUser(userId: number, event: string, payload: unknown): void;
}

export const noRealtime: Realtime = { toPermission: () => {}, toUser: () => {} };

const permRoom = (orgId: number, p: Permission) => `org:${orgId}:perm:${p}`;
const userRoom = (userId: number) => `user:${userId}`;

export function attachRealtime(http: HttpServer, opts: { jwtSecret: string; origins: string[]; log: Logger }): Realtime & { io: Server } {
  const io = new Server(http, {
    path: '/socket.io',
    cors: { origin: opts.origins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string') return next(new Error('unauthenticated'));
    try {
      const ctx = await verifyAccessToken(token, opts.jwtSecret);
      socket.data.ctx = ctx;
      // Disconnect when the (already verified) token expires; the client reconnects with a fresh one.
      const { exp } = decodeJwt(token);
      if (exp) {
        const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
        socket.on('disconnect', () => clearTimeout(timer));
      }
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });

  io.on('connection', (socket) => {
    const ctx = socket.data.ctx as Awaited<ReturnType<typeof verifyAccessToken>>;
    void socket.join([userRoom(ctx.userId), ...[...ctx.permissions].map((p) => permRoom(ctx.orgId, p))]);
  });

  opts.log.info('realtime channel ready on /socket.io');
  return {
    io,
    toPermission: (orgId, permission, event, payload) => {
      io.to(permRoom(orgId, permission)).emit(event, payload);
    },
    toUser: (userId, event, payload) => {
      io.to(userRoom(userId)).emit(event, payload);
    },
  };
}
