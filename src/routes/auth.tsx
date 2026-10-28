import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import { signInWithUid } from "@/lib/auth.functions";
import { normalizeUid } from "@/lib/uid";
import { isValidOtp, normalizePhoneNumber } from "@/lib/phone";
import { GENERIC_SIGNIN_ERROR, NO_ADMIN_ACCESS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isAdminProfile, validateNewPassword, validateSignup } from "@/lib/auth-validation";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => {
    const redirect = search["redirect"];
    return {
      redirect:
        typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
          ? redirect
          : "/browse",
    };
  },
  head: () => ({
    meta: [
      { title: "Sign in — CampusFind" },
      {
        name: "description",
        content: "Sign in to CampusFind securely with your mobile number and a one-time code.",
      },
      { property: "og:title", content: "Sign in — CampusFind" },
      {
        property: "og:description",
        content: "Use phone verification to access your campus lost-and-found account.",
      },
    ],
  }),
  component: AuthPage,
});

const field =
  "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3.5 text-sm transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15";

type AuthMode = "in" | "code" | "recover" | "up" | "admin";
type AuthStep = "details" | "otp" | "password";
type SignupDetails = { uid: string; fullName: string };

const btn =
  "mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60";

function sendErrorMessage(message: string): string {
  if (/phone_provider_disabled|unsupported phone provider|phone provider.*disabled/i.test(message)) {
    return "Phone verification isn't enabled for CampusFind yet. The administrator must enable Phone sign-in and configure an SMS provider before codes can be sent.";
  }
  if (/sms.*provider|provider.*sms|failed to send sms|unable to send sms|error sending sms/i.test(message)) {
    return "CampusFind couldn't deliver the SMS. The administrator should check the SMS provider credentials and delivery settings.";
  }
  if (/rate limit|too many requests|retry after/i.test(message)) {
    return "Too many code requests. Please wait a little before trying again.";
  }
  if (/invalid phone|phone.*invalid|not a valid phone/i.test(message)) {
    return "Enter a valid mobile number. Use 10 digits for an Indian number, or include + and the country code for other numbers.";
  }
  if (/signups not allowed|user not found|otp.*disabled/i.test(message)) {
    return "We couldn't send a code to that number. Check it, or create an account first.";
  }
  return "We couldn't send a code right now. Please check the number and try again.";
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("in");
  const [step, setStep] = useState<AuthStep>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fullName, setFullName] = useState("");
  const [uid, setUid] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneForOtp, setPhoneForOtp] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupDetails, setSignupDetails] = useState<SignupDetails | null>(null);

  function switchMode(nextMode: AuthMode) {
    if (busy) return;
    setMode(nextMode);
    setStep("details");
    setError("");
    setNotice("");
    setOtp("");
    setPassword("");
    setConfirmPassword("");
    setSignupDetails(null);
    setFullName("");
    setUid("");
    setPhoneInput("");
    setPhoneForOtp("");
  }

  async function requestOtp(phone: string, targetMode: AuthMode, details?: SignupDetails) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const options: { shouldCreateUser: boolean; data?: { uid: string; full_name: string } } = {
        // Only signup may create an account. Code sign-in and recovery never do.
        shouldCreateUser: targetMode === "up",
      };
      if (targetMode === "up" && details) options.data = { uid: details.uid, full_name: details.fullName };

      const { error: sendError } = await supabase.auth.signInWithOtp({ phone, options });
      if (sendError) {
        setError(sendErrorMessage(sendError.message));
        return;
      }
      setPhoneForOtp(phone);
      setOtp("");
      setStep("otp");
      setNotice(`A six-digit verification code was requested for ${phone}.`);
    } catch {
      setError("Something went wrong while requesting a code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function passwordSignIn(phone: string): Promise<boolean> {
    const { error: signInError } = await supabase.auth.signInWithPassword({ phone, password });
    if (signInError) {
      const status = (signInError as { status?: number }).status ?? 0;
      setError(status >= 500 || status === 0 && /fetch|network/i.test(signInError.message)
        ? "Sign-in is temporarily unavailable. Please try again later."
        : GENERIC_SIGNIN_ERROR);
      return false;
    }
    return true;
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");

    if (mode === "admin") {
      const adminUid = normalizeUid(uid);
      if (!/^[A-Z0-9]{5,20}$/.test(adminUid)) {
        setError("Enter a valid administrator UID.");
        return;
      }
      if (!password) {
        setError("Enter your password.");
        return;
      }
      setBusy(true);
      try {
        // Existing admin account was created with UID/password before phone auth.
        // Resolve the UID server-side and authenticate through Supabase; never look up email on the client.
        const result = await signInWithUid({ data: { uid: adminUid, password } });
        if (!result.ok) {
          setError(result.error || GENERIC_SIGNIN_ERROR);
          return;
        }
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        if (sessionError) throw sessionError;

        const { data: userData, error: userError } = await supabase.auth.getUser();
        const { data: profile, error: profileError } = userData.user
          ? await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle()
          : { data: null, error: null };

        if (userError || profileError || !isAdminProfile(profile)) {
          await supabase.auth.signOut();
          setPassword("");
          setError(NO_ADMIN_ACCESS);
          return;
        }
        navigate({ to: "/admin", replace: true });
      } catch {
        setError("Administrator sign-in is temporarily unavailable. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "up") {
      const result = validateSignup({ fullName, uid, phone: phoneInput, password, confirmPassword });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const details = { uid: result.value.uid, fullName: result.value.fullName };
      setSignupDetails(details);
      await requestOtp(result.value.phone, mode, details);
      return;
    }

    const phone = normalizePhoneNumber(phoneInput);
    if (!phone) {
      setError("Enter a valid mobile number. Indian numbers can be entered as 10 digits; other countries need a +country code.");
      return;
    }

    if (mode === "in") {
      if (!password) {
        setError("Enter your password.");
        return;
      }
      setBusy(true);
      try {
        if (!(await passwordSignIn(phone))) return;
        navigate({ to: redirect, replace: true });
      } catch {
        setError("Sign-in is temporarily unavailable. Please try again later.");
      } finally {
        setBusy(false);
      }
      return;
    }

    await requestOtp(phone, mode);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const token = otp.trim();
    if (!isValidOtp(token)) {
      setError("Enter the six-digit code from your SMS.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ phone: phoneForOtp, token, type: "sms" });
      if (verifyError || !data.session) {
        const status = (verifyError as { status?: number } | null)?.status ?? 0;
        const message = verifyError?.message ?? "";

        if (/expired|invalid.*(otp|token|code)|otp.*invalid|token.*invalid/i.test(message)) {
          setError("That code is incorrect or expired. Use the most recent six-digit code, or request a new one.");
        } else if (status >= 500 || !verifyError) {
          setError("CampusFind couldn't finish verification because of a server error. This doesn't necessarily mean your code is wrong. Please request a fresh code and try again.");
        } else {
          setError("We couldn't verify that code. Check that you entered the latest six-digit code, or request a new one.");
        }
        return;
      }

      if (mode === "up") {
        const verifiedUid = normalizeUid(data.user?.user_metadata?.["uid"]);
        if (!signupDetails || verifiedUid !== signupDetails.uid) {
          await supabase.auth.signOut();
          setStep("details");
          setPhoneInput(phoneForOtp);
          setError("This phone number is already linked to another CampusFind account. Switch to Sign in or use another number.");
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          // Account is verified and signed in; let the student retry setting a password.
          setPassword("");
          setConfirmPassword("");
          setStep("password");
          setError("Your phone is verified, but we couldn't save your password. Please choose a password again.");
          return;
        }
        setPassword("");
        setConfirmPassword("");
        navigate({ to: redirect, replace: true });
        return;
      }

      if (mode === "recover") {
        setPassword("");
        setConfirmPassword("");
        setStep("password");
        setNotice("Phone verified. Choose a new password for your account.");
        return;
      }

      navigate({ to: redirect, replace: true });
    } catch {
      setError("Something went wrong while verifying the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const problem = validateNewPassword(password, confirmPassword);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          /same.*password|different from the old/i.test(updateError.message)
            ? "Choose a password different from your current one."
            : "We couldn't save your password. Please try again.",
        );
        return;
      }
      setPassword("");
      setConfirmPassword("");
      navigate({ to: redirect, replace: true });
    } catch {
      setError("We couldn't save your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changePhoneNumber() {
    setStep("details");
    setPhoneInput(phoneForOtp);
    setOtp("");
    setError("");
    setNotice("");
  }

  const messages = (
    <>
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold leading-6 text-emerald-900">{notice}</p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-bold leading-6 text-destructive">{error}</p>
      )}
    </>
  );

  const passwordFields = (autoComplete: "new-password" | "current-password", withConfirm: boolean) => (
    <>
      <label className="mt-4 block text-sm font-extrabold text-foreground">
        Password
        <input required name="password" type="password" autoComplete={autoComplete} minLength={withConfirm ? PASSWORD_MIN_LENGTH : undefined} maxLength={PASSWORD_MAX_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={withConfirm ? `At least ${PASSWORD_MIN_LENGTH} characters` : "Your password"} className={field} />
      </label>
      {withConfirm && (
        <label className="mt-4 block text-sm font-extrabold text-foreground">
          Confirm password
          <input required name="confirm_password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password" className={field} />
        </label>
      )}
    </>
  );

  const titles: Record<AuthMode, [string, string]> = {
    in: ["Sign in", "Use your mobile number and password."],
    code: ["Sign in with a code", "We'll text a one-time code to your registered number."],
    recover: ["Forgot / set password", "Verify your registered number by SMS, then choose a new password."],
    up: ["Create account", "Add your student details and a password, then verify your mobile number."],
    admin: ["Administrator sign in", "Use your administrator UID and existing account password. Access is checked against your account role."],
  };

  return (
    <Page>
      <section className="mx-auto grid max-w-7xl gap-7 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1fr_0.9fr] lg:items-stretch lg:py-14">
        <aside className="relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-[2rem] bg-gradient-ink p-7 text-ink-foreground sm:p-10 lg:min-h-[650px] lg:p-12">
          <div className="pointer-events-none absolute -right-12 top-14 size-64 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-extrabold text-white/80">
              <ShieldCheck size={15} className="text-emerald-200" /> A safer campus starts here
            </span>
            <h1 className="mt-8 max-w-xl text-4xl font-extrabold leading-tight text-white sm:text-5xl lg:text-6xl">
              {mode === "in"
                ? "Welcome back to a more connected campus."
                : "Join your campus lost & found."}
            </h1>
            <p className="mt-5 max-w-lg leading-7 text-white/70">
              Use your mobile number and a one-time code to access reports, publish an item, and
              manage match alerts in one place. No CU email or password needed.
            </p>
          </div>
          <div className="relative mt-10">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200">
                  <LockKeyhole size={20} />
                </span>
                <p className="mt-4 text-sm font-extrabold text-white">Private by design</p>
                <p className="mt-1 text-xs leading-5 text-white/60">
                  Only share the details needed to find an item.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200">
                  <Sparkles size={20} />
                </span>
                <p className="mt-4 text-sm font-extrabold text-white">Made for students</p>
                <p className="mt-1 text-xs leading-5 text-white/60">
                  Keep your report and search journey in one place.
                </p>
              </div>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs font-bold text-white/50">
              <CheckCircle2 size={15} className="text-emerald-200" /> Chandigarh University campus community
            </p>
          </div>
        </aside>

        <div className="flex flex-col justify-center rounded-[2rem] border border-border bg-white p-5 shadow-xl shadow-primary/5 sm:p-8 lg:p-10">
          {step === "otp" ? (
            <div className="py-3 sm:py-5">
              <span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800"><Smartphone size={27} /></span>
              <p className="mt-6 kicker text-emerald-800">Phone verification</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Check your phone</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Enter the six-digit code sent to <strong className="text-foreground">{phoneForOtp}</strong>{" "}
                to {mode === "up" ? "finish creating your account" : mode === "recover" ? "reset your password" : "sign in"}.
              </p>
              <form onSubmit={verifyCode} className="mt-6">
                <label className="block text-sm font-extrabold text-foreground">
                  Verification code
                  <input required name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Enter 6-digit code" className={field} />
                </label>
                {messages}
                <button type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy ? "Verifying…" : mode === "up" ? "Verify & create account" : mode === "recover" ? "Verify code" : "Verify & sign in"}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                <button type="button" disabled={busy} onClick={changePhoneNumber} className="inline-flex items-center gap-2 font-extrabold text-muted-foreground hover:text-foreground disabled:opacity-60"><ArrowLeft size={15} /> Change number</button>
                <button type="button" disabled={busy} onClick={() => void requestOtp(phoneForOtp, mode, signupDetails ?? undefined)} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Resend code</button>
              </div>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-emerald-800" />
                <p className="text-xs leading-5 text-muted-foreground">Never share your verification code with anyone, including someone claiming to be from CampusFind.</p>
              </div>
            </div>
          ) : step === "password" ? (
            <div className="py-3 sm:py-5">
              <span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800"><LockKeyhole size={27} /></span>
              <p className="mt-6 kicker text-emerald-800">Account password</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Choose a new password</h2>
              <p className="mt-4 leading-7 text-muted-foreground">You'll use it with <strong className="text-foreground">{phoneForOtp}</strong> to sign in next time.</p>
              <form onSubmit={saveNewPassword} className="mt-2">
                {passwordFields("new-password", true)}
                {messages}
                <button type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy ? "Saving…" : "Save password & continue"}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>
            </div>
          ) : (
            <>
              <div>
                <p className="kicker text-emerald-800">{mode === "admin" ? "Administrator" : "Student access"}</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{titles[mode][0]}</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{titles[mode][1]}</p>
              </div>

              <div className="mt-7 grid grid-cols-3 rounded-xl bg-secondary p-1" role="group" aria-label="Choose account type">
                {([["in", "Sign in"], ["up", "Create account"], ["admin", "Administrator"]] as const).map(([nextMode, label]) => {
                  const active = mode === nextMode || (nextMode === "in" && (mode === "code" || mode === "recover"));
                  return (
                    <button type="button" key={nextMode} disabled={busy} onClick={() => switchMode(nextMode)} aria-pressed={active} className={`rounded-lg px-2 py-2.5 text-xs font-extrabold transition sm:text-sm ${active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={submitDetails} className="mt-6" noValidate={false}>
                {mode === "up" && (
                  <label className="mb-4 block text-sm font-extrabold text-foreground">
                    Student name
                    <input required name="full_name" maxLength={80} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" className={field} />
                  </label>
                )}

                {(mode === "up" || mode === "admin") && (
                  <label className="mb-4 block text-sm font-extrabold text-foreground">
                    {mode === "admin" ? "Administrator UID" : "Student UID"}
                    <input required name="uid" maxLength={20} autoComplete="username" autoCapitalize="characters" value={uid} onChange={(event) => setUid(event.target.value.toUpperCase())} placeholder="e.g. 26BCS11930" className={`${field} uppercase`} />
                  </label>
                )}

                {mode !== "admin" && (
                  <>
                    <label className="block text-sm font-extrabold text-foreground">
                      Student phone number
                      <input required name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} placeholder="98765 43210" className={field} />
                    </label>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Indian mobile numbers can be entered as 10 digits. For another country, include the +country code.</p>
                  </>
                )}

                {(mode === "in" || mode === "admin") && passwordFields("current-password", false)}
                {mode === "up" && passwordFields("new-password", true)}

                {messages}
                <button type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy
                    ? "Please wait…"
                    : mode === "in"
                      ? "Sign in"
                      : mode === "admin"
                        ? "Sign in as administrator"
                        : mode === "up"
                          ? "Send verification code"
                          : mode === "recover"
                            ? "Send reset code"
                            : "Send sign-in code"}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>

              {(mode === "in" || mode === "code" || mode === "recover") && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  {mode === "in" ? (
                    <button type="button" disabled={busy} onClick={() => switchMode("code")} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Sign in with a code</button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => switchMode("in")} className="inline-flex items-center gap-2 font-extrabold text-muted-foreground hover:text-foreground disabled:opacity-60"><ArrowLeft size={15} /> Sign in with password</button>
                  )}
                  {mode !== "recover" && (
                    <button type="button" disabled={busy} onClick={() => switchMode("recover")} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Forgot / set password</button>
                  )}
                </div>
              )}

              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-emerald-800" />
                <p className="text-xs leading-5 text-muted-foreground">
                  {mode === "admin"
                    ? "Administrator access is granted only by CampusFind maintainers. Accounts without it are signed out."
                    : "Existing accounts without a password can use “Forgot / set password” to add one. Never share verification codes."}
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}
