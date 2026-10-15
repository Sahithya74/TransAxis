/**
 * Approximate highway corridors (waypoints along the national highways). Distances and durations are
 * typical road figures for loaded trucks, not computed from the polylines, which are coarse.
 */
export interface RouteFixture {
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  durationMin: number;
  toll: number;
  polyline: [number, number][];
}

const CHENNAI_BENGALURU: [number, number][] = [
  [13.0827, 80.2707], [13.0475, 80.1100], [12.9675, 79.9419], [12.9200, 79.7000], [12.9165, 79.1325],
  [12.7904, 78.7166], [12.6800, 78.6200], [12.5186, 78.2137], [12.7409, 77.8253], [12.8450, 77.6650], [12.9716, 77.5946],
];
const CHENNAI_HYDERABAD: [number, number][] = [
  [13.0827, 80.2707], [13.4078, 80.1094], [13.9000, 79.9600], [14.4426, 79.9865], [14.9163, 79.9944],
  [15.5057, 80.0499], [16.0500, 79.7400], [16.4800, 79.4300], [16.8700, 79.5600], [17.2000, 79.2000], [17.3850, 78.4867],
];
const CHENNAI_COIMBATORE: [number, number][] = [
  [13.0827, 80.2707], [12.9675, 79.9419], [12.9165, 79.1325], [12.5186, 78.2137], [12.1211, 78.1582],
  [11.6643, 78.1460], [11.3410, 77.7172], [11.1085, 77.3411], [11.0168, 76.9558],
];
const BENGALURU_HYDERABAD: [number, number][] = [
  [12.9716, 77.5946], [13.4355, 77.7315], [14.1500, 77.7900], [14.6819, 77.6006], [15.1100, 77.6400],
  [15.8281, 78.0373], [16.4000, 78.0900], [16.7600, 78.1400], [17.2400, 78.4300], [17.3850, 78.4867],
];
const CHENNAI_TRICHY: [number, number][] = [
  [13.0827, 80.2707], [12.6921, 79.9707], [12.2342, 79.6554], [11.9401, 79.4861], [11.6826, 79.2862],
  [11.2342, 78.8826], [10.7905, 78.7047],
];
const PUNE_BHIWANDI: [number, number][] = [
  [18.5204, 73.8567], [18.6400, 73.7600], [18.7546, 73.4062], [18.8300, 73.2800], [18.9894, 73.1175],
  [19.1500, 73.0700], [19.2813, 73.0483],
];
const PUNE_NASHIK: [number, number][] = [
  [18.5204, 73.8567], [18.7606, 73.8636], [19.0900, 74.0100], [19.5700, 74.2100], [19.8500, 74.0000], [19.9975, 73.7898],
];

const reverse = (p: [number, number][]) => [...p].reverse();

export const KAVERI_ROUTES: RouteFixture[] = [
  { name: 'Chennai – Bengaluru (NH48)', origin: 'Chennai', destination: 'Bengaluru', distanceKm: 346, durationMin: 480, toll: 1450, polyline: CHENNAI_BENGALURU },
  { name: 'Bengaluru – Chennai (NH48)', origin: 'Bengaluru', destination: 'Chennai', distanceKm: 346, durationMin: 480, toll: 1450, polyline: reverse(CHENNAI_BENGALURU) },
  { name: 'Chennai – Hyderabad (NH16/NH65)', origin: 'Chennai', destination: 'Hyderabad', distanceKm: 627, durationMin: 900, toll: 2650, polyline: CHENNAI_HYDERABAD },
  { name: 'Hyderabad – Chennai (NH65/NH16)', origin: 'Hyderabad', destination: 'Chennai', distanceKm: 627, durationMin: 900, toll: 2650, polyline: reverse(CHENNAI_HYDERABAD) },
  { name: 'Chennai – Coimbatore (NH544)', origin: 'Chennai', destination: 'Coimbatore', distanceKm: 505, durationMin: 660, toll: 1980, polyline: CHENNAI_COIMBATORE },
  { name: 'Coimbatore – Chennai (NH544)', origin: 'Coimbatore', destination: 'Chennai', distanceKm: 505, durationMin: 660, toll: 1980, polyline: reverse(CHENNAI_COIMBATORE) },
  { name: 'Bengaluru – Hyderabad (NH44)', origin: 'Bengaluru', destination: 'Hyderabad', distanceKm: 570, durationMin: 750, toll: 2100, polyline: BENGALURU_HYDERABAD },
  { name: 'Hyderabad – Bengaluru (NH44)', origin: 'Hyderabad', destination: 'Bengaluru', distanceKm: 570, durationMin: 750, toll: 2100, polyline: reverse(BENGALURU_HYDERABAD) },
  { name: 'Chennai – Tiruchirappalli (NH38)', origin: 'Chennai', destination: 'Tiruchirappalli', distanceKm: 330, durationMin: 450, toll: 1120, polyline: CHENNAI_TRICHY },
  { name: 'Tiruchirappalli – Chennai (NH38)', origin: 'Tiruchirappalli', destination: 'Chennai', distanceKm: 330, durationMin: 450, toll: 1120, polyline: reverse(CHENNAI_TRICHY) },
];

export const SAHYADRI_ROUTES: RouteFixture[] = [
  { name: 'Pune – Bhiwandi (Expressway)', origin: 'Pune', destination: 'Bhiwandi', distanceKm: 160, durationMin: 270, toll: 980, polyline: PUNE_BHIWANDI },
  { name: 'Bhiwandi – Pune (Expressway)', origin: 'Bhiwandi', destination: 'Pune', distanceKm: 160, durationMin: 270, toll: 980, polyline: reverse(PUNE_BHIWANDI) },
  { name: 'Pune – Nashik (NH60)', origin: 'Pune', destination: 'Nashik', distanceKm: 210, durationMin: 330, toll: 640, polyline: PUNE_NASHIK },
  { name: 'Nashik – Pune (NH60)', origin: 'Nashik', destination: 'Pune', distanceKm: 210, durationMin: 330, toll: 640, polyline: reverse(PUNE_NASHIK) },
];
