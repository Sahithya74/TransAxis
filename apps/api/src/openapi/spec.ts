import { z } from 'zod';
import {
  idParamSchema,
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  vehicleCreateSchema,
  vehicleDocumentInputSchema,
  vehicleListQuerySchema,
  vehicleTypeInputSchema,
  vehicleUpdateSchema,
  type Permission,
} from '@transaxis/shared';

/**
 * OpenAPI 3.1 description built from the same zod schemas the routes validate with, so the docs
 * cannot drift from the real request rules. Add an entry here whenever a route is added.
 */
interface Op {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** Any-of permissions; omitted for public endpoints. */
  permission?: Permission[] | 'authenticated';
  query?: z.ZodObject;
  params?: z.ZodObject;
  body?: z.ZodType;
  multipart?: Record<string, { type: 'string'; format?: 'binary'; enum?: readonly string[] }>;
  responses: Record<number, string>;
}

const docParams = z.object({ id: z.number().int(), docId: z.number().int() });

const ops: Op[] = [
  { method: 'get', path: '/health', tag: 'System', summary: 'Service health', responses: { 200: 'Healthy', 503: 'A dependency is down' } },

  { method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Sign in', description: 'Returns an access token (15 min) and sets the httpOnly `tx_rt` refresh cookie. 5 failures lock the account for 15 minutes.', body: loginRequestSchema, responses: { 200: 'Session', 400: 'Invalid payload', 401: 'Invalid credentials or locked', 429: 'Rate limited' } },
  { method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate the refresh cookie and get a new access token', description: 'Reusing a rotated token revokes every session in its family.', responses: { 200: 'Session', 401: 'No valid session', 403: 'Foreign origin', 409: 'Concurrent refresh, retry' } },
  { method: 'post', path: '/auth/logout', tag: 'Auth', summary: 'Revoke the current session family', responses: { 204: 'Signed out' } },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current user, roles, permissions and organisation', permission: 'authenticated', responses: { 200: 'Profile', 401: 'Not signed in' } },
  { method: 'post', path: '/auth/change-password', tag: 'Auth', summary: 'Change password (signs out other sessions)', permission: 'authenticated', body: z.object({ currentPassword: z.string(), newPassword: z.string() }), responses: { 200: 'New session', 400: 'Wrong current password or weak new password' } },
  { method: 'post', path: '/auth/password-reset/request', tag: 'Auth', summary: 'Request a reset link (always 202)', body: passwordResetRequestSchema, responses: { 202: 'Accepted' } },
  { method: 'post', path: '/auth/password-reset/confirm', tag: 'Auth', summary: 'Set a new password with a single-use token', body: passwordResetConfirmSchema, responses: { 204: 'Password changed', 400: 'Invalid/expired token or weak password' } },

  { method: 'get', path: '/vehicles', tag: 'Vehicles', summary: 'List vehicles', permission: ['vehicles:read'], query: vehicleListQuerySchema, responses: { 200: 'Paginated vehicles with compliance summary' } },
  { method: 'post', path: '/vehicles', tag: 'Vehicles', summary: 'Register a vehicle', permission: ['vehicles:write'], body: vehicleCreateSchema, responses: { 201: 'Created', 400: 'Invalid', 409: 'Registration already exists' } },
  { method: 'get', path: '/vehicles/summary', tag: 'Vehicles', summary: 'Fleet counts by status and compliance', permission: ['vehicles:read'], responses: { 200: 'Summary' } },
  { method: 'get', path: '/vehicles/{id}', tag: 'Vehicles', summary: 'Vehicle detail', permission: ['vehicles:read'], params: idParamSchema, responses: { 200: 'Vehicle', 404: 'Not found (or another organisation\'s)' } },
  { method: 'patch', path: '/vehicles/{id}', tag: 'Vehicles', summary: 'Update a vehicle (partial)', description: '`assigned`/`on_trip` are managed by trips and cannot be set or overridden manually.', permission: ['vehicles:write'], params: idParamSchema, body: vehicleUpdateSchema, responses: { 200: 'Updated', 422: 'Business rule violated' } },
  { method: 'get', path: '/vehicles/{id}/documents', tag: 'Vehicles', summary: 'Compliance documents', permission: ['vehicles:read'], params: idParamSchema, responses: { 200: 'Documents' } },
  { method: 'post', path: '/vehicles/{id}/documents', tag: 'Vehicles', summary: 'Add a compliance document', permission: ['vehicle_documents:write'], params: idParamSchema, body: vehicleDocumentInputSchema, responses: { 201: 'Created' } },
  { method: 'put', path: '/vehicles/{id}/documents/{docId}', tag: 'Vehicles', summary: 'Replace a compliance document', permission: ['vehicle_documents:write'], params: docParams, body: vehicleDocumentInputSchema, responses: { 200: 'Updated' } },
  { method: 'delete', path: '/vehicles/{id}/documents/{docId}', tag: 'Vehicles', summary: 'Delete a compliance document', permission: ['vehicle_documents:write'], params: docParams, responses: { 204: 'Deleted' } },
  { method: 'get', path: '/vehicle-types', tag: 'Vehicles', summary: 'Vehicle types', permission: ['vehicles:read'], responses: { 200: 'Types' } },
  { method: 'post', path: '/vehicle-types', tag: 'Vehicles', summary: 'Create a vehicle type', permission: ['vehicles:write'], body: vehicleTypeInputSchema, responses: { 201: 'Created', 409: 'Name exists' } },
  { method: 'patch', path: '/vehicle-types/{id}', tag: 'Vehicles', summary: 'Update a vehicle type', permission: ['vehicles:write'], params: idParamSchema, body: vehicleTypeInputSchema.partial(), responses: { 200: 'Updated' } },

  { method: 'get', path: '/reference/branches', tag: 'Reference', summary: 'Active branches of the organisation', permission: 'authenticated', responses: { 200: 'Branches' } },

  { method: 'post', path: '/files', tag: 'Files', summary: 'Upload a file', description: 'Type is detected from content. The category decides allowed types and the permission required.', permission: 'authenticated', multipart: { category: { type: 'string', enum: ['vehicle_document', 'general'] }, file: { type: 'string', format: 'binary' } }, responses: { 201: 'Stored', 413: 'Too large', 415: 'Type not allowed' } },
  { method: 'get', path: '/files/{id}/download', tag: 'Files', summary: 'Download a file (audited)', permission: 'authenticated', params: idParamSchema, responses: { 200: 'File content', 404: 'Not found or not permitted' } },
];

const toSchema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const parameters: unknown[] = [];
    for (const [where, obj] of [['query', op.query], ['path', op.params]] as const) {
      if (!obj) continue;
      const json = toSchema(obj) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(json.properties ?? {})) {
        parameters.push({ name, in: where, required: where === 'path' || (json.required ?? []).includes(name), schema });
      }
    }
    const perm =
      op.permission === 'authenticated'
        ? '\n\n**Requires:** any signed-in user.'
        : op.permission
          ? `\n\n**Requires permission:** ${op.permission.map((p) => `\`${p}\``).join(' or ')}`
          : '';
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: `${op.description ?? ''}${perm}`.trim() || undefined,
      security: op.permission ? [{ bearer: [] }] : [],
      parameters: parameters.length ? parameters : undefined,
      requestBody: op.body
        ? { required: true, content: { 'application/json': { schema: toSchema(op.body) } } }
        : op.multipart
          ? { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: op.multipart, required: Object.keys(op.multipart) } } } }
          : undefined,
      responses: Object.fromEntries(
        Object.entries(op.responses).map(([code, description]) => [
          code,
          Number(code) >= 400 ? { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } : { description },
        ]),
      ),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'TransAxis API',
      version: '0.1.0',
      description:
        'Fleet management and transport operations API. All data is scoped to the caller\'s organisation; rows belonging to other organisations are reported as 404.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', examples: ['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'] },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
