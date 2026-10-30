/**
 * University UID rules shared by signup and server-side UID login.
 * Never log UIDs during authentication.
 */
export function normalizeUid(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isValidUid(value: unknown): boolean {
  const uid = normalizeUid(value);
  return /^[A-Z0-9]{5,20}$/.test(uid);
}
