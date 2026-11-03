// UTM inverso (série de Snyder), zona 23 sul, WGS84. Existe para não depender de biblioteca
// só para converter o ponto do sensor; app.js confere a conta contra o geojson ao iniciar.

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

export function utmParaLatLon(leste, norte, zona = 23, hemisferioSul = true) {
  const x = leste - 500000;
  const y = hemisferioSul ? norte - 10000000 : norte;
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sen = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const N1 = A / Math.sqrt(1 - E2 * sen ** 2);
  const T1 = tan ** 2;
  const C1 = EP2 * cos ** 2;
  const R1 = A * (1 - E2) / (1 - E2 * sen ** 2) ** 1.5;
  const D = x / (N1 * K0);
  const lat = phi1 - (N1 * tan / R1) * (
    D ** 2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6 / 720);
  const lon0 = (zona * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (
    D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5 / 120) / cos;
  return { lat: lat * 180 / Math.PI, lng: lon * 180 / Math.PI };
}

// UTM direto (Snyder), o caminho de volta. O cadastro feito no mapa chega ao banco em lat/lng e
// precisa virar ponto no 3D, que é em metros a partir de origem_utm.
export function latLonParaUtm(lat, lng, zona = 23, hemisferioSul = true) {
  const phi = lat * Math.PI / 180;
  const lon0 = (zona * 6 - 183) * Math.PI / 180;
  const sen = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sen ** 2);
  const T = tan ** 2;
  const C = EP2 * cos ** 2;
  const Ac = cos * (lng * Math.PI / 180 - lon0);
  const M = A * (
    (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
  const leste = 500000 + K0 * N * (
    Ac + (1 - T + C) * Ac ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Ac ** 5 / 120);
  const norte = K0 * (M + N * tan * (
    Ac ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * Ac ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Ac ** 6 / 720));
  return { leste, norte: hemisferioSul ? norte + 10000000 : norte };
}

/** Distância em metros entre dois pontos lat/lng (haversine). */
export function distanciaM(a, b) {
  const R = 6371008.8;
  const rad = (g) => g * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
