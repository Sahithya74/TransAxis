import { z } from 'zod';
import type { Permission, RoleKey } from './index.js';

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const passwordResetRequestSchema = z.object({
  email: loginRequestSchema.shape.email,
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/** The authenticated principal as the web app sees it. */
export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  roles: RoleKey[];
  permissions: Permission[];
  workerId: number | null;
  customerId: number | null;
  mustChangePassword: boolean;
}

export interface SessionOrganization {
  id: number;
  name: string;
  timezone: string;
  currency: string;
}

export interface SessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: SessionUser;
  organization: SessionOrganization;
}
