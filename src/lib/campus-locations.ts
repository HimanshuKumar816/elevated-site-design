export const CAMPUS_LOCATIONS = [
  "Academic Block / Classroom",
  "Central Library",
  "Hostel / Residence",
  "Canteen / Food Court",
  "Laboratory",
  "Sports Complex / Gym",
  "Auditorium / Seminar Hall",
  "Administration Office",
  "Main Gate / Security",
  "Parking Area",
  "Bus Stop / Transport",
  "Other campus location",
] as const;

export type CampusLocation = (typeof CAMPUS_LOCATIONS)[number];

export function buildCampusLocation(zone: CampusLocation, detail: string): string {
  const extra = detail.trim().replace(/\s+/g, " ");
  return extra ? `${zone} — ${extra}` : zone;
}
