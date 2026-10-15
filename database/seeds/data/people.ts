/** Fictional names for demo workers. */
export const KAVERI_DRIVERS = [
  'Murugan Selvam', 'Rajesh Kumar', 'Senthil Nathan', 'Karthik Raja', 'Prakash Babu', 'Venkatesh Rao',
  'Suresh Gowda', 'Manikandan P', 'Arunachalam K', 'Dinesh Reddy', 'Ganesan M', 'Balaji Srinivasan',
  'Ramesh Naidu', 'Saravanan T', 'Vijay Anand', 'Mohan Das', 'Kumaravel R', 'Anbalagan S',
  'Chandrasekar V', 'Thirumalai N', 'Shankar Prasad', 'Gopal Krishnan', 'Mahesh Hegde', 'Naveen Kumar',
  'Ravi Teja', 'Sathish Kannan', 'Elango P', 'Bharath Raj', 'Imran Basha', 'Joseph Antony',
];
export const KAVERI_HELPERS = [
  'Muthu Kumar', 'Selvaraj A', 'Pandian K', 'Ayyappan R', 'Kannan V',
  'Raju M', 'Veeramani S', 'Siva Prakash', 'Durai Raj', 'Anwar Hussain',
];
export const SAHYADRI_DRIVERS = [
  'Sanjay Patil', 'Ganesh Shinde', 'Mahesh Jadhav', 'Rohit Pawar', 'Vishal More', 'Sachin Kale', 'Amol Deshmukh', 'Prashant Gaikwad',
];
export const SAHYADRI_HELPERS = ['Sunil Bhosale', 'Nitin Waghmare'];

export const RECIPIENTS = ['Store manager', 'Warehouse supervisor', 'Security officer', 'Plant receiving clerk', 'Logistics coordinator'];

export const INSPECTION_ITEMS_PRE = [
  { key: 'tyres', label: 'Tyres: pressure, tread and cuts', critical: true },
  { key: 'brakes', label: 'Service and parking brakes', critical: true },
  { key: 'lights', label: 'Lights, indicators and reflectors', critical: true },
  { key: 'horn', label: 'Horn', critical: false },
  { key: 'mirrors', label: 'Mirrors and windscreen', critical: false },
  { key: 'fluids', label: 'Engine oil, coolant and AdBlue levels', critical: false },
  { key: 'fuel', label: 'Fuel sufficient for first leg', critical: false },
  { key: 'documents', label: 'RC, insurance, permit, PUC and LR on board', critical: true },
  { key: 'extinguisher', label: 'Fire extinguisher charged', critical: true },
  { key: 'first_aid', label: 'First-aid kit', critical: false },
  { key: 'load_secured', label: 'Load secured, tarpaulin and ropes / container sealed', critical: true },
  { key: 'tracker', label: 'GPS tracker powered', critical: false },
];

export const INSPECTION_ITEMS_POST = [
  { key: 'body_damage', label: 'No new body damage', critical: true },
  { key: 'tyres', label: 'Tyres checked after trip', critical: false },
  { key: 'cargo_area', label: 'Cargo area empty and clean', critical: false },
  { key: 'fuel_level', label: 'Fuel level recorded', critical: false },
  { key: 'odometer', label: 'Odometer recorded', critical: true },
];
