import { normalizePhoneNumber } from "@/lib/phone";

export function validateNotificationPreference(phoneNumber: string, smsEnabled: boolean): string | null {
  const phone = phoneNumber.trim();
  const normalizedPhone = normalizePhoneNumber(phone);

  if (smsEnabled && !phone) {
    return "Enter a mobile number before enabling SMS alerts.";
  }
  if (phone && !normalizedPhone) {
    return "Enter a valid phone number with country code, for example +919876543210.";
  }
  if (phone && !smsEnabled) {
    return "Check the SMS consent box to save your mobile number, or clear the number to continue.";
  }
  return null;
}

export function buildNotificationPreferencePayload(
  userId: string,
  phoneNumber: string,
  smsEnabled: boolean,
  updatedAt = new Date().toISOString(),
) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const optedIn = smsEnabled && Boolean(normalizedPhone);

  return {
    user_id: userId,
    phone_number: optedIn ? normalizedPhone : null,
    sms_notifications_enabled: optedIn,
    updated_at: updatedAt,
  };
}
