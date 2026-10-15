/** Enumerations shared by the database schema, API validation and the web UI. */

export const VEHICLE_STATUSES = [
  'available',
  'assigned',
  'on_trip',
  'under_maintenance',
  'unavailable',
  'retired',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Statuses a user may set by hand. `assigned` / `on_trip` are owned by the trip lifecycle. */
export const MANUAL_VEHICLE_STATUSES = [
  'available',
  'under_maintenance',
  'unavailable',
  'retired',
] as const satisfies readonly VehicleStatus[];

export const BODY_TYPES = [
  'open',
  'closed',
  'container',
  'reefer',
  'tanker',
  'flatbed',
  'tipper',
  'trailer',
  'other',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const VEHICLE_OWNERSHIP = ['owned', 'leased', 'attached', 'hired'] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIP)[number];

export const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'lng', 'electric', 'other'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const VEHICLE_DOC_TYPES = [
  'registration',
  'insurance',
  'fitness',
  'permit',
  'pollution',
  'road_tax',
  'other',
] as const;
export type VehicleDocType = (typeof VEHICLE_DOC_TYPES)[number];

/** Documents a goods vehicle must hold valid to be dispatched (India defaults). */
export const MANDATORY_VEHICLE_DOCS: readonly VehicleDocType[] = [
  'registration',
  'insurance',
  'fitness',
  'permit',
  'pollution',
];

export const VEHICLE_DOC_LABELS: Record<VehicleDocType, string> = {
  registration: 'Registration Certificate (RC)',
  insurance: 'Insurance',
  fitness: 'Fitness Certificate',
  permit: 'Goods Carriage Permit',
  pollution: 'Pollution Under Control (PUC)',
  road_tax: 'Road Tax',
  other: 'Other',
};

/** Indian driving licence classes relevant to goods transport. */
export const LICENCE_CLASSES = ['LMV', 'LMV-TR', 'MGV', 'HGMV', 'HPMV', 'HTV', 'TRAILER'] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];
