export type CampusCoordinate = { lat: number; lng: number };

export const CAMPUS_CENTER: [number, number] = [30.76858, 76.57386];

export const CAMPUS_BOUNDS = {
  south: 30.761,
  west: 76.56,
  north: 30.778,
  east: 76.586,
};

export const CAMPUS_BOUNDS_ARRAY: [[number, number], [number, number]] = [
  [CAMPUS_BOUNDS.south, CAMPUS_BOUNDS.west],
  [CAMPUS_BOUNDS.north, CAMPUS_BOUNDS.east],
];

export function isInsideCampus(position: CampusCoordinate): boolean {
  return (
    Number.isFinite(position.lat) &&
    Number.isFinite(position.lng) &&
    position.lat >= CAMPUS_BOUNDS.south &&
    position.lat <= CAMPUS_BOUNDS.north &&
    position.lng >= CAMPUS_BOUNDS.west &&
    position.lng <= CAMPUS_BOUNDS.east
  );
}
