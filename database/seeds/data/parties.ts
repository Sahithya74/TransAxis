/** Fictional customers, vendors and depots. GSTINs follow the format but are not real registrations. */
import type { CargoCategory, VendorType } from '@transaxis/shared';

export interface CustomerFixture {
  code: string;
  name: string;
  city: string;
  state: string;
  stateCode: string;
  site: [number, number];
  siteName: string;
  /** Typical cargo for generated bookings. */
  cargo: { description: string; category: CargoCategory; unit: string; kgPerUnit: number; hsn: string };
  /** Lanes this customer ships on, as route names. */
  lanes: string[];
  terms: number;
}

export const KAVERI_CUSTOMERS: CustomerFixture[] = [
  { code: 'CCW', name: 'Coromandel Cement Works', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', site: [13.2146, 80.3203], siteName: 'Ennore Grinding Unit', cargo: { description: 'OPC 53 cement, 50 kg bags', category: 'general', unit: 'bags', kgPerUnit: 50, hsn: '2523' }, lanes: ['Chennai – Bengaluru (NH48)', 'Chennai – Tiruchirappalli (NH38)'], terms: 30 },
  { code: 'MTX', name: 'Marina Textiles', city: 'Coimbatore', state: 'Tamil Nadu', stateCode: '33', site: [11.0168, 76.9558], siteName: 'Peelamedu Mill', cargo: { description: 'Cotton yarn cones', category: 'general', unit: 'cartons', kgPerUnit: 25, hsn: '5205' }, lanes: ['Coimbatore – Chennai (NH544)'], terms: 45 },
  { code: 'DST', name: 'Deccan Steel Traders', city: 'Hyderabad', state: 'Telangana', stateCode: '36', site: [17.4948, 78.3996], siteName: 'Kukatpally Yard', cargo: { description: 'TMT bars 12 mm', category: 'oversized', unit: 'bundles', kgPerUnit: 1000, hsn: '7214' }, lanes: ['Hyderabad – Chennai (NH65/NH16)', 'Hyderabad – Bengaluru (NH44)'], terms: 30 },
  { code: 'PAF', name: 'Palar Agro Foods', city: 'Vellore', state: 'Tamil Nadu', stateCode: '33', site: [12.9165, 79.1325], siteName: 'Vellore Processing Plant', cargo: { description: 'Packaged rice, 25 kg bags', category: 'general', unit: 'bags', kgPerUnit: 25, hsn: '1006' }, lanes: ['Chennai – Bengaluru (NH48)'], terms: 21 },
  { code: 'NPD', name: 'Nilgiri Pharma Distributors', city: 'Coimbatore', state: 'Tamil Nadu', stateCode: '33', site: [11.03, 77.01], siteName: 'Coimbatore Cold Store', cargo: { description: 'Vaccines and biologics (2–8 °C)', category: 'perishable', unit: 'cartons', kgPerUnit: 12, hsn: '3002' }, lanes: ['Chennai – Coimbatore (NH544)'], terms: 30 },
  { code: 'BAC', name: 'Bay Auto Components', city: 'Sriperumbudur', state: 'Tamil Nadu', stateCode: '33', site: [12.9675, 79.9419], siteName: 'Sriperumbudur Plant 2', cargo: { description: 'Brake assemblies on pallets', category: 'fragile', unit: 'pallets', kgPerUnit: 450, hsn: '8708' }, lanes: ['Chennai – Bengaluru (NH48)', 'Chennai – Hyderabad (NH16/NH65)'], terms: 45 },
  { code: 'SVP', name: 'Sri Venkatesa Paper Mills', city: 'Tiruchirappalli', state: 'Tamil Nadu', stateCode: '33', site: [10.805, 78.6856], siteName: 'Trichy Mill', cargo: { description: 'Kraft paper reels', category: 'general', unit: 'reels', kgPerUnit: 800, hsn: '4804' }, lanes: ['Tiruchirappalli – Chennai (NH38)'], terms: 30 },
  { code: 'HEL', name: 'Hosur Electricals', city: 'Hosur', state: 'Tamil Nadu', stateCode: '33', site: [12.7409, 77.8253], siteName: 'SIPCOT Phase I', cargo: { description: 'Distribution transformers', category: 'high_value', unit: 'units', kgPerUnit: 1800, hsn: '8504' }, lanes: ['Bengaluru – Chennai (NH48)'], terms: 30 },
  { code: 'CBV', name: 'Chola Beverages', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', site: [13.1143, 80.1548], siteName: 'Ambattur Bottling', cargo: { description: 'Packaged drinking water, 20 L jars', category: 'liquid_bulk', unit: 'jars', kgPerUnit: 21, hsn: '2201' }, lanes: ['Chennai – Tiruchirappalli (NH38)', 'Chennai – Bengaluru (NH48)'], terms: 15 },
  { code: 'GDP', name: 'Godavari Plastics', city: 'Hyderabad', state: 'Telangana', stateCode: '36', site: [17.5326, 78.2649], siteName: 'Patancheru Works', cargo: { description: 'HDPE granules, 25 kg bags', category: 'general', unit: 'bags', kgPerUnit: 25, hsn: '3901' }, lanes: ['Hyderabad – Bengaluru (NH44)'], terms: 30 },
  { code: 'KGE', name: 'Karnataka Granite Exports', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', site: [12.9716, 77.5946], siteName: 'Bengaluru Cutting Yard', cargo: { description: 'Polished granite slabs', category: 'fragile', unit: 'slabs', kgPerUnit: 600, hsn: '6802' }, lanes: ['Bengaluru – Chennai (NH48)', 'Bengaluru – Hyderabad (NH44)'], terms: 45 },
  { code: 'STD', name: 'Southern Tyres Depot', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', site: [13.0285, 77.5197], siteName: 'Peenya Warehouse', cargo: { description: 'Truck tyres', category: 'general', unit: 'tyres', kgPerUnit: 55, hsn: '4011' }, lanes: ['Bengaluru – Hyderabad (NH44)'], terms: 30 },
  { code: 'KRC', name: 'Krishna Ceramics', city: 'Hyderabad', state: 'Telangana', stateCode: '36', site: [17.36, 78.55], siteName: 'Uppal Factory', cargo: { description: 'Vitrified tiles, boxed', category: 'fragile', unit: 'boxes', kgPerUnit: 30, hsn: '6907' }, lanes: ['Hyderabad – Chennai (NH65/NH16)'], terms: 30 },
  { code: 'VLE', name: 'Vellore Leather Exports', city: 'Ambur', state: 'Tamil Nadu', stateCode: '33', site: [12.7904, 78.7166], siteName: 'Ambur Tannery', cargo: { description: 'Finished leather bales', category: 'general', unit: 'bales', kgPerUnit: 40, hsn: '4107' }, lanes: ['Bengaluru – Chennai (NH48)'], terms: 60 },
  { code: 'SCH', name: 'Sriharikota Chemicals', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', site: [13.1650, 80.3010], siteName: 'Manali Industrial Area', cargo: { description: 'Industrial solvent drums (UN1993, Class 3)', category: 'hazardous', unit: 'drums', kgPerUnit: 200, hsn: '2902' }, lanes: ['Chennai – Hyderabad (NH16/NH65)'], terms: 30 },
];

export const SAHYADRI_CUSTOMERS: CustomerFixture[] = [
  { code: 'CAP', name: 'Chakan Auto Parts', city: 'Pune', state: 'Maharashtra', stateCode: '27', site: [18.7606, 73.8636], siteName: 'Chakan Plant', cargo: { description: 'Gearbox housings', category: 'general', unit: 'pallets', kgPerUnit: 500, hsn: '8708' }, lanes: ['Pune – Bhiwandi (Expressway)'], terms: 30 },
  { code: 'BLP', name: 'Bhiwandi Logistics Park', city: 'Bhiwandi', state: 'Maharashtra', stateCode: '27', site: [19.2813, 73.0483], siteName: 'Warehouse 7', cargo: { description: 'FMCG cartons', category: 'general', unit: 'cartons', kgPerUnit: 15, hsn: '3401' }, lanes: ['Bhiwandi – Pune (Expressway)'], terms: 21 },
  { code: 'NGC', name: 'Nashik Grapes Co-operative', city: 'Nashik', state: 'Maharashtra', stateCode: '27', site: [19.9975, 73.7898], siteName: 'Pack House', cargo: { description: 'Table grapes, crated', category: 'perishable', unit: 'crates', kgPerUnit: 9, hsn: '0806' }, lanes: ['Nashik – Pune (NH60)'], terms: 15 },
  { code: 'PPL', name: 'Pune Pharma Labs', city: 'Pune', state: 'Maharashtra', stateCode: '27', site: [18.56, 73.93], siteName: 'Hadapsar Unit', cargo: { description: 'Tablets, cartoned', category: 'general', unit: 'cartons', kgPerUnit: 10, hsn: '3004' }, lanes: ['Pune – Nashik (NH60)'], terms: 30 },
  { code: 'KPT', name: 'Konkan Paints', city: 'Pune', state: 'Maharashtra', stateCode: '27', site: [18.62, 73.80], siteName: 'Pimpri Depot', cargo: { description: 'Paint tins', category: 'general', unit: 'tins', kgPerUnit: 20, hsn: '3208' }, lanes: ['Pune – Bhiwandi (Expressway)'], terms: 30 },
];

export interface VendorFixture {
  code: string;
  name: string;
  type: VendorType;
  city: string;
  state: string;
  stateCode: string;
  contact: string;
}

export const KAVERI_VENDORS: VendorFixture[] = [
  { code: 'V-ATC', name: 'Ambattur Truck Care', type: 'workshop', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Rajendran' },
  { code: 'V-KHG', name: 'Krishnagiri Highway Garage', type: 'workshop', city: 'Krishnagiri', state: 'Tamil Nadu', stateCode: '33', contact: 'Basheer' },
  { code: 'V-NTR', name: 'Nellore Truck Repair', type: 'workshop', city: 'Nellore', state: 'Andhra Pradesh', stateCode: '37', contact: 'Srinivasulu' },
  { code: 'V-HFS', name: 'Highway Fuels Sriperumbudur', type: 'fuel_station', city: 'Sriperumbudur', state: 'Tamil Nadu', stateCode: '33', contact: 'Station manager' },
  { code: 'V-HFP', name: 'Hosur Fuel Point', type: 'fuel_station', city: 'Hosur', state: 'Tamil Nadu', stateCode: '33', contact: 'Station manager' },
  { code: 'V-RTS', name: 'Ranga Transport Services', type: 'subcontractor', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Ranganathan' },
  { code: 'V-MTH', name: 'Madras Tyre House', type: 'tyre_dealer', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Abdul Kareem' },
  { code: 'V-ASA', name: 'Ashok Spares Agency', type: 'parts_supplier', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Ashok' },
  { code: 'V-CFB', name: 'Chennai Freight Brokers', type: 'freight_agent', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Vasanth' },
  { code: 'V-SIA', name: 'Suraksha Insurance Advisors', type: 'insurer', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', contact: 'Deepa' },
];

export const SAHYADRI_VENDORS: VendorFixture[] = [
  { code: 'V-CTW', name: 'Chakan Truck Workshop', type: 'workshop', city: 'Pune', state: 'Maharashtra', stateCode: '27', contact: 'Patil' },
  { code: 'V-EFS', name: 'Expressway Fuel Stop', type: 'fuel_station', city: 'Khalapur', state: 'Maharashtra', stateCode: '27', contact: 'Station manager' },
  { code: 'V-DTC', name: 'Deccan Tyre Centre', type: 'tyre_dealer', city: 'Pune', state: 'Maharashtra', stateCode: '27', contact: 'Joshi' },
];

/** Org depots, used as stops for empty and return trips. */
export const KAVERI_DEPOTS = [
  { name: 'Kaveri Madhavaram Depot', city: 'Chennai', state: 'Tamil Nadu', site: [13.147, 80.231] as [number, number] },
  { name: 'Kaveri Bengaluru Hub', city: 'Bengaluru', state: 'Karnataka', site: [12.99, 77.53] as [number, number] },
  { name: 'Kaveri Hyderabad Hub', city: 'Hyderabad', state: 'Telangana', site: [17.45, 78.38] as [number, number] },
];
export const SAHYADRI_DEPOTS = [
  { name: 'Sahyadri Chakan Depot', city: 'Pune', state: 'Maharashtra', site: [18.74, 73.85] as [number, number] },
];

/** Generic consignee site per destination city, used when the destination is not the customer's own site. */
export const CONSIGNEE_SITES: Record<string, { name: string; site: [number, number]; state: string }> = {
  Chennai: { name: 'Consignee warehouse, Red Hills', site: [13.1866, 80.1999], state: 'Tamil Nadu' },
  Bengaluru: { name: 'Consignee DC, Nelamangala', site: [13.0983, 77.3936], state: 'Karnataka' },
  Hyderabad: { name: 'Consignee DC, Shamshabad', site: [17.2403, 78.4294], state: 'Telangana' },
  Coimbatore: { name: 'Consignee depot, Kurichi', site: [10.9600, 76.9600], state: 'Tamil Nadu' },
  Tiruchirappalli: { name: 'Consignee godown, Thuvakudi', site: [10.7510, 78.8200], state: 'Tamil Nadu' },
  Bhiwandi: { name: 'Consignee DC, Vadape', site: [19.3000, 73.0900], state: 'Maharashtra' },
  Pune: { name: 'Consignee warehouse, Wagholi', site: [18.5800, 73.9800], state: 'Maharashtra' },
  Nashik: { name: 'Consignee depot, Ambad MIDC', site: [19.9500, 73.7300], state: 'Maharashtra' },
};
