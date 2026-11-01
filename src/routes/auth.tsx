import { Button } from "@/components/ui/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { recordSuccessfulLogin } from "@/lib/login-events";
import { isValidUid, normalizeUid } from "@/lib/uid";
import { isValidOtp, normalizePhoneNumber } from "@/lib/phone";
import { GENERIC_SIGNIN_ERROR, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword, validateSignup } from "@/lib/auth-validation";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Sign in — CampusFind" },
      {
        name: "description",
        content: "Sign in to CampusFind securely with your student UID and password.",
      },
      { property: "og:title", content: "Sign in — CampusFind" },
      {
        property: "og:description",
        content: "Use your student UID and password to access your campus lost-and-found account.",
      },
    ],
  }),
  component: AuthPage,
});

const field =
  "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3.5 text-sm transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15";

type AuthMode = "in" | "code" | "recover" | "up";
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

  async function requestOtp(phone: string, targetMode: AuthMode, details?: SignupDetails, allowWhileBusy = false) {
    if (busy && !allowWhileBusy) return;
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

  async function passwordSignIn(studentUid: string): Promise<"student" | "admin" | false> {
    const result = await signInWithUid({ data: { uid: studentUid, password } });
    if (!result.ok) {
      setError(result.error || GENERIC_SIGNIN_ERROR);
      return false;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (sessionError) {
      setError("Sign-in is temporarily unavailable. Please try again later.");
      return false;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      await supabase.auth.signOut();
      setError("We couldn't verify your account. Please sign in again.");
      return false;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || !profile || (profile.role !== "student" && profile.role !== "admin")) {
      await supabase.auth.signOut();
      setError("We couldn't load your account details. Please try again.");
      return false;
    }

    await recordSuccessfulLogin("password");
    return profile.role;
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");

    if (mode === "up") {
      const result = validateSignup({ fullName, uid, phone: phoneInput, password, confirmPassword });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setBusy(true);
      try {
        // Avoid a public UID-existence pre-check. The database unique constraint
        // and signup trigger are authoritative; this prevents account enumeration.
        const details = { uid: result.value.uid, fullName: result.value.fullName };
        setSignupDetails(details);
        await requestOtp(result.value.phone, mode, details, true);
      } catch {
        setError("We couldn't start account creation. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "in") {
      const studentUid = normalizeUid(uid);
      if (!isValidUid(studentUid)) {
        setError("Enter a valid university UID (5–20 letters and numbers).");
        return;
      }
      if (!password) {
        setError("Enter your password.");
        return;
      }

      setBusy(true);
      try {
        const role = await passwordSignIn(studentUid);
        if (!role) return;
        navigate({ to: role === "admin" ? "/admin" : redirect, replace: true });
      } catch {
        setError("Sign-in is temporarily unavailable. Please try again later.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const phone = normalizePhoneNumber(phoneInput);
    if (!phone) {
      setError("Enter a valid mobile number. Indian numbers can be entered as 10 digits; other countries need a +country code.");
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

        if (mode === "up" && /already registered|duplicate key|unique constraint|database error saving new user/i.test(message)) {
          setStep("details");
          setPhoneInput(phoneForOtp);
          setError("We couldn't create the account with those details. Check the student UID and phone number, or sign in if you already have an account.");
        } else if (/expired|invalid.*(otp|token|code)|otp.*invalid|token.*invalid/i.test(message)) {
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
        await recordSuccessfulLogin("signup");
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

      await recordSuccessfulLogin("otp");
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
        <p role="status" className="mt-4 rounded-xl bg-success-soft p-3 text-sm font-bold leading-6 text-success-foreground">{notice}</p>
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
    in: ["Sign in", "Use your student UID and password."],
    code: ["Sign in with a code", "We'll text a one-time code to your registered number."],
    recover: ["Forgot / set password", "Verify your registered number by SMS, then choose a new password."],
    up: ["Create account", "Add your student details and a password, then verify your mobile number."],
  };

  return (
    <Page>
      <section className="cf-auth-layout mx-auto grid max-w-7xl gap-7 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1fr_0.9fr] lg:items-stretch lg:py-14">
        <aside className="cf-auth-aside relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-[2rem] bg-gradient-ink p-7 text-ink-foreground sm:p-10 lg:min-h-[650px] lg:p-12">
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-foreground/15 bg-card/10 px-3.5 py-2 text-xs font-extrabold text-ink-foreground/80">
              <ShieldCheck size={15} className="text-success" /> A safer campus starts here
            </span>
            <h1 className="mt-8 max-w-xl text-4xl font-extrabold leading-tight text-ink-foreground sm:text-5xl lg:text-6xl">
              {mode === "in"
                ? "Welcome back to a more connected campus."
                : "Join your campus lost & found."}
            </h1>
            <p className="mt-5 max-w-lg leading-7 text-ink-foreground/70">
              Sign in with your student UID and password. Your mobile number is used for account verification and password recovery.
            </p>
          </div>
          <div className="relative mt-10">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-foreground/10 bg-card/5 p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-success/15 text-success">
                  <LockKeyhole size={20} />
                </span>
                <p className="mt-4 text-sm font-extrabold text-ink-foreground">Private by design</p>
                <p className="mt-1 text-xs leading-5 text-ink-foreground/60">
                  Only share the details needed to find an item.
                </p>
              </div>
              <div className="rounded-2xl border border-ink-foreground/10 bg-card/5 p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-success/15 text-success">
                  <Sparkles size={20} />
                </span>
                <p className="mt-4 text-sm font-extrabold text-ink-foreground">Made for students</p>
                <p className="mt-1 text-xs leading-5 text-ink-foreground/60">
                  Keep your report and search journey in one place.
                </p>
              </div>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs font-bold text-ink-foreground/50">
              <CheckCircle2 size={15} className="text-success" /> Chandigarh University campus community
            </p>
          </div>
        </aside>

        <div className="cf-auth-form flex flex-col justify-center rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-primary/5 sm:p-8 lg:p-10">
          {step === "otp" ? (
            <div className="py-3 sm:py-5">
              <span className="grid size-14 place-items-center rounded-2xl bg-success-soft text-success-foreground"><Smartphone size={27} /></span>
              <p className="mt-6 kicker text-primary">Phone verification</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-normal text-foreground sm:text-4xl">Check your phone</h2>
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
                <Button variant="plain" type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy ? "Verifying…" : mode === "up" ? "Verify & create account" : mode === "recover" ? "Verify code" : "Verify & sign in"}
                  {!busy && <ArrowRight size={17} />}
                </Button>
              </form>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                <Button variant="plain" type="button" disabled={busy} onClick={changePhoneNumber} className="inline-flex items-center gap-2 font-extrabold text-muted-foreground hover:text-foreground disabled:opacity-60"><ArrowLeft size={15} /> Change number</Button>
                <Button variant="plain" type="button" disabled={busy} onClick={() => void requestOtp(phoneForOtp, mode, signupDetails ?? undefined)} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Resend code</Button>
              </div>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-success-foreground" />
                <p className="text-xs leading-5 text-muted-foreground">Never share your verification code with anyone, including someone claiming to be from CampusFind.</p>
              </div>
            </div>
          ) : step === "password" ? (
            <div className="py-3 sm:py-5">
              <span className="grid size-14 place-items-center rounded-2xl bg-success-soft text-success-foreground"><LockKeyhole size={27} /></span>
              <p className="mt-6 kicker text-primary">Account password</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-normal text-foreground sm:text-4xl">Choose a new password</h2>
              <p className="mt-4 leading-7 text-muted-foreground">You'll use your student UID with this password to sign in next time.</p>
              <form onSubmit={saveNewPassword} className="mt-2">
                {passwordFields("new-password", true)}
                {messages}
                <Button variant="plain" type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy ? "Saving…" : "Save password & continue"}
                  {!busy && <ArrowRight size={17} />}
                </Button>
              </form>
            </div>
          ) : (
            <>
              <div>
                <p className="kicker text-primary">Student access</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-normal text-foreground sm:text-4xl">{titles[mode][0]}</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{titles[mode][1]}</p>
              </div>

              <div className="mt-7 grid grid-cols-2 rounded-xl bg-secondary p-1" role="group" aria-label="Choose account type">
                {([["in", "Sign in"], ["up", "Create account"]] as const).map(([nextMode, label]) => {
                  const active = mode === nextMode || (nextMode === "in" && (mode === "code" || mode === "recover"));
                  return (
                    <Button variant="plain" type="button" key={nextMode} disabled={busy} onClick={() => switchMode(nextMode)} aria-pressed={active} className={`rounded-lg px-2 py-2.5 text-xs font-extrabold transition sm:text-sm ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      {label}
                    </Button>
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

                {(mode === "up" || mode === "in") && (
                  <label className="mb-4 block text-sm font-extrabold text-foreground">
                    Student UID
                    <input required name="uid" maxLength={20} autoComplete="username" autoCapitalize="characters" value={uid} onChange={(event) => setUid(event.target.value.toUpperCase())} placeholder="Enter your university UID" className={`${field} uppercase`} />
                  </label>
                )}

                {mode !== "in" && (
                  <>
                    <label className="block text-sm font-extrabold text-foreground">
                      Student phone number
                      <input required name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} placeholder="Enter your registered mobile number" className={field} />
                    </label>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Your number is used for verification and password recovery. Indian mobile numbers can be entered as 10 digits.</p>
                  </>
                )}

                {mode === "in" && passwordFields("current-password", false)}
                {mode === "up" && passwordFields("new-password", true)}

                {messages}
                <Button variant="plain" type="submit" disabled={busy} aria-busy={busy} className={btn}>
                  {busy
                    ? "Please wait…"
                    : mode === "in"
                      ? "Sign in"
                      : mode === "up"
                          ? "Send verification code"
                          : mode === "recover"
                            ? "Send reset code"
                            : "Send sign-in code"}
                  {!busy && <ArrowRight size={17} />}
                </Button>
              </form>

              {(mode === "in" || mode === "code" || mode === "recover") && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  {mode === "in" ? (
                    <Button variant="plain" type="button" disabled={busy} onClick={() => switchMode("code")} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Sign in with a code</Button>
                  ) : (
                    <Button variant="plain" type="button" disabled={busy} onClick={() => switchMode("in")} className="inline-flex items-center gap-2 font-extrabold text-muted-foreground hover:text-foreground disabled:opacity-60"><ArrowLeft size={15} /> Sign in with password</Button>
                  )}
                  {mode !== "recover" && (
                    <Button variant="plain" type="button" disabled={busy} onClick={() => switchMode("recover")} className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60">Forgot / set password</Button>
                  )}
                </div>
              )}

              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-success-foreground" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Existing accounts without a password can use “Forgot / set password” to add one. Never share verification codes.
                </p>
              </div>
              <div className="mt-5 border-t border-border pt-5">
                <p className="text-xs leading-5 text-muted-foreground">CampusFind administrator?</p>
                <Link to="/admin-login" className="mt-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-primary transition hover:underline">
                  Open administrator portal
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}
