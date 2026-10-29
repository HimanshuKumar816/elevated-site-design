import { supabase } from "@/integrations/supabase/client";

export type LoginMethod = "password" | "otp" | "signup";

/**
 * Records a successful login using the authenticated user's own identity.
 * Failure to record activity must not prevent a valid user from reaching the app.
 */
export async function recordSuccessfulLogin(loginMethod: LoginMethod): Promise<boolean> {
  try {
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
      console.warn("CampusFind could not record a login event because no authenticated user was available.");
      return false;
    }

    const { error: insertError } = await supabase.from("login_events").insert({
      user_id: data.user.id,
      login_method: loginMethod,
    });

    if (insertError) {
      console.warn("CampusFind could not save the successful login event.");
      return false;
    }

    return true;
  } catch {
    console.warn("CampusFind could not save the successful login event.");
    return false;
  }
}
