/**
 * Fictional demo tenants. Company names, people and registration numbers are invented; any
 * resemblance to real entities is unintended. Vehicle makes/models are real product lines used
 * only to make the fleet look realistic.
 */
import type { BodyType, LicenceClass, RoleKey } from '@transaxis/shared';

export const DEMO_PASSWORD = 'Demo@12345';

export interface OrgFixture {
  code: string;
  name: string;
  legalName: string;
  gstin: string;
  city: string;
  state: string;
  addressLine: string;
  branches: { name: string; city: string; state: string }[];
  users: { email: string; fullName: string; role: RoleKey; phone?: string }[];
  /** Registration prefixes used when generating this org's fleet. */
  plates: string[];
  fleetSize: number;
}

export const PLATFORM_ORG: OrgFixture = {
  code: 'TXP',
  name: 'TransAxis Platform',
  legalName: 'TransAxis Platform Operations (demo)',
  gstin: '',
  city: 'Chennai',
  state: 'Tamil Nadu',
  addressLine: 'Platform operator tenant',
  branches: [],
  users: [{ email: 'admin@transaxis.demo', fullName: 'Platform Administrator', role: 'super_admin' }],
  plates: [],
  fleetSize: 0,
};

export const KAVERI: OrgFixture = {
  code: 'KRL',
  name: 'Kaveri Roadlines',
  legalName: 'Kaveri Roadlines Private Limited',
  gstin: '33AAKCK4821M1Z5',
  city: 'Chennai',
  state: 'Tamil Nadu',
  addressLine: 'Plot 14, SIDCO Truck Terminal, Madhavaram, Chennai 600110',
  branches: [
    { name: 'Chennai HQ', city: 'Chennai', state: 'Tamil Nadu' },
    { name: 'Bengaluru Hub', city: 'Bengaluru', state: 'Karnataka' },
    { name: 'Hyderabad Hub', city: 'Hyderabad', state: 'Telangana' },
  ],
  users: [
    { email: 'owner@kaveri.demo', fullName: 'Meenakshi Sundaram', role: 'owner', phone: '+91 98400 11001' },
    { email: 'dispatch@kaveri.demo', fullName: 'Arjun Ramesh', role: 'dispatcher', phone: '+91 98400 11002' },
    { email: 'finance@kaveri.demo', fullName: 'Lakshmi Narayanan', role: 'accountant', phone: '+91 98400 11003' },
    { email: 'maintenance@kaveri.demo', fullName: 'Ravi Shankar', role: 'maintenance_manager', phone: '+91 98400 11004' },
    { email: 'control@kaveri.demo', fullName: 'Priya Venkatesh', role: 'control_room', phone: '+91 98400 11005' },
    { email: 'hr@kaveri.demo', fullName: 'Kavitha Raman', role: 'hr_manager', phone: '+91 98400 11006' },
    { email: 'driver@kaveri.demo', fullName: 'Murugan Selvam', role: 'driver', phone: '+91 98400 11007' },
    { email: 'customer@kaveri.demo', fullName: 'Anil Mehta (Coromandel Cement)', role: 'customer', phone: '+91 98400 11008' },
  ],
  plates: ['TN01', 'TN02', 'TN04', 'TN09', 'TN18', 'KA01', 'KA05', 'TS09', 'AP16'],
  fleetSize: 25,
};

/** Second tenant, used to prove data isolation. */
export const SAHYADRI: OrgFixture = {
  code: 'SFC',
  name: 'Sahyadri Freight Carriers',
  legalName: 'Sahyadri Freight Carriers LLP',
  gstin: '27AAQFS7310K1Z8',
  city: 'Pune',
  state: 'Maharashtra',
  addressLine: 'Gat No. 212, Chakan MIDC Phase II, Pune 410501',
  branches: [
    { name: 'Pune HQ', city: 'Pune', state: 'Maharashtra' },
    { name: 'Bhiwandi Hub', city: 'Bhiwandi', state: 'Maharashtra' },
  ],
  users: [
    { email: 'owner@sahyadri.demo', fullName: 'Vikram Deshpande', role: 'owner' },
    { email: 'dispatch@sahyadri.demo', fullName: 'Sneha Kulkarni', role: 'dispatcher' },
  ],
  plates: ['MH12', 'MH14', 'MH04', 'MH43'],
  fleetSize: 6,
};

export interface VehicleTypeFixture {
  name: string;
  bodyType: BodyType;
  requiredLicenceClass: LicenceClass;
  defaultPayloadKg: number;
  models: [make: string, model: string, kmpl: number][];
}

export const VEHICLE_TYPES: VehicleTypeFixture[] = [
  {
    name: 'LCV 3.5T Closed',
    bodyType: 'closed',
    requiredLicenceClass: 'LMV-TR',
    defaultPayloadKg: 3500,
    models: [['Tata', 'Ultra T.7', 9.5], ['Eicher', 'Pro 2049', 10.2]],
  },
  {
    name: '6-Wheeler 9T Open',
    bodyType: 'open',
    requiredLicenceClass: 'HGMV',
    defaultPayloadKg: 9000,
    models: [['Tata', 'LPT 1412', 6.8], ['Ashok Leyland', 'Ecomet 1415', 6.5]],
  },
  {
    name: '10-Wheeler 16T Open',
    bodyType: 'open',
    requiredLicenceClass: 'HGMV',
    defaultPayloadKg: 16000,
    models: [['Ashok Leyland', '2820', 4.6], ['BharatBenz', '2823R', 4.8]],
  },
  {
    name: '12-Wheeler 21T Open',
    bodyType: 'open',
    requiredLicenceClass: 'HGMV',
    defaultPayloadKg: 21000,
    models: [['Tata', 'Signa 3523.T', 4.0], ['Ashok Leyland', '3120', 3.9]],
  },
  {
    name: '32ft MXL Container',
    bodyType: 'container',
    requiredLicenceClass: 'HGMV',
    defaultPayloadKg: 15000,
    models: [['Tata', 'Signa 2823.K', 4.4], ['Eicher', 'Pro 6028', 4.5]],
  },
  {
    name: 'Reefer 20ft',
    bodyType: 'reefer',
    requiredLicenceClass: 'HGMV',
    defaultPayloadKg: 8000,
    models: [['BharatBenz', '1617R Reefer', 5.6]],
  },
  {
    name: '40ft Trailer',
    bodyType: 'trailer',
    requiredLicenceClass: 'TRAILER',
    defaultPayloadKg: 30000,
    models: [['Tata', 'Signa 4825.T', 3.2], ['Mahindra', 'Blazo X 49', 3.3]],
  },
];
