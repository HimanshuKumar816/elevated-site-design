import { isValidUid, normalizeUid } from "@/lib/uid";
import { normalizePhoneNumber } from "@/lib/phone";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** Returns an error message, or null when the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

export type SignupInput = {
  fullName: string;
  uid: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export type SignupValidation =
  | { ok: true; value: { fullName: string; uid: string; phone: string; password: string } }
  | { ok: false; error: string };

export function validateSignup(input: SignupInput): SignupValidation {
  const fullName = input.fullName.trim();
  if (!fullName || fullName.length > 80) {
    return { ok: false, error: "Enter your full name (up to 80 characters)." };
  }
  const uid = normalizeUid(input.uid);
  if (!isValidUid(uid)) {
    return { ok: false, error: "Enter a valid university ID (5–20 letters and numbers only)." };
  }
  const phone = normalizePhoneNumber(input.phone);
  if (!phone) {
    return {
      ok: false,
      error:
        "Enter a valid mobile number. Indian numbers can be entered as 10 digits; other countries need a +country code.",
    };
  }
  const passwordError = validateNewPassword(input.password, input.confirmPassword);
  if (passwordError) return { ok: false, error: passwordError };
  return { ok: true, value: { fullName, uid, phone, password: input.password } };
}

/** Same generic message for unknown phone and wrong password. */
export const GENERIC_SIGNIN_ERROR = "Incorrect UID or password.";
export const NO_ADMIN_ACCESS = "No administrator access.";

/** Role check from the caller's own RLS-protected profile row; anything other than 'admin' is denied. */
export function isAdminProfile(profile: { role?: unknown } | null | undefined): boolean {
  return profile?.role === "admin";
}
