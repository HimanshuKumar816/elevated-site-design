const PHONE_NUMBER_PATTERN = /^\+?[1-9]\d{9,14}$/;

export function validateNotificationPreference(phoneNumber: string, smsEnabled: boolean): string | null {
  const phone = phoneNumber.trim();

  if (smsEnabled && !phone) {
    return "Enter a mobile number before enabling SMS alerts.";
  }
  if (phone && !PHONE_NUMBER_PATTERN.test(phone)) {
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
  const phone = phoneNumber.trim();
  const optedIn = smsEnabled && PHONE_NUMBER_PATTERN.test(phone);

  return {
    user_id: userId,
    phone_number: optedIn ? phone : null,
    sms_notifications_enabled: optedIn,
    updated_at: updatedAt,
  };
}
