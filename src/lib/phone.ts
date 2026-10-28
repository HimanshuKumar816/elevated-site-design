/**
 * Helpers for phone OTP authentication.
 * Indian mobile numbers may be entered without a country code; all other numbers
 * must use international E.164 format (for example, +14155552671).
 */
export function normalizePhoneNumber(value: unknown): string {
  const compact = String(value ?? "").trim().replace(/[\s().-]/g, "");

  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^91\d{10}$/.test(compact)) return `+${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;

  return "";
}

export function isValidOtp(value: unknown): boolean {
  return /^\d{6}$/.test(String(value ?? "").trim());
}
