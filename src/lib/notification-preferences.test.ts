import { describe, expect, it } from "vitest";
import {
  buildNotificationPreferencePayload,
  validateNotificationPreference,
} from "./notification-preferences";

describe("notification preferences", () => {
  it("requires a phone number when SMS consent is enabled", () => {
    expect(validateNotificationPreference("", true)).toBe(
      "Enter a mobile number before enabling SMS alerts.",
    );
  });

  it("validates phone numbers with a country code", () => {
    expect(validateNotificationPreference("123", true)).toBe(
      "Enter a valid phone number with country code, for example +919876543210.",
    );
    expect(validateNotificationPreference("+919876543210", true)).toBeNull();
  });

  it("does not save a number without explicit SMS consent", () => {
    expect(validateNotificationPreference("+919876543210", false)).toBe(
      "Check the SMS consent box to save your mobile number, or clear the number to continue.",
    );
  });

  it("stores the number only when the user explicitly opts in", () => {
    expect(buildNotificationPreferencePayload("user-1", "+919876543210", true, "2026-10-28T10:00:00.000Z")).toEqual({
      user_id: "user-1",
      phone_number: "+919876543210",
      sms_notifications_enabled: true,
      updated_at: "2026-10-28T10:00:00.000Z",
    });
  });

  it("clears the stored number when SMS consent is withdrawn", () => {
    expect(buildNotificationPreferencePayload("user-1", "", false, "2026-10-28T10:00:00.000Z")).toEqual({
      user_id: "user-1",
      phone_number: null,
      sms_notifications_enabled: false,
      updated_at: "2026-10-28T10:00:00.000Z",
    });
  });
});
