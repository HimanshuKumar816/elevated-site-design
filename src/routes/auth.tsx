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
import { isValidUid, normalizeUid } from "@/lib/uid";
import { isValidOtp, normalizePhoneNumber } from "@/lib/phone";

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

type AuthMode = "in" | "up";
type AuthStep = "details" | "otp";
type SignupDetails = { uid: string; fullName: string };

function sendErrorMessage(message: string): string {
  if (/phone_provider_disabled|unsupported phone provider|phone provider.*disabled/i.test(message)) {
    return "Phone verification isn't enabled for CampusFind yet. The administrator must enable Phone sign-in in Supabase Authentication → Providers and configure an SMS provider before codes can be sent.";
  }
  if (/sms.*provider|provider.*sms|failed to send sms|unable to send sms|error sending sms/i.test(message)) {
    return "CampusFind couldn't deliver the SMS. The administrator should check the SMS provider credentials and delivery settings in Supabase.";
  }
  if (/rate limit|too many requests|retry after/i.test(message)) {
    return "Too many code requests. Please wait a little before trying again.";
  }
  if (/invalid phone|phone.*invalid|not a valid phone/i.test(message)) {
    return "Enter a valid mobile number. Use 10 digits for an Indian number, or include + and the country code for other numbers.";
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
  const [signupDetails, setSignupDetails] = useState<SignupDetails | null>(null);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setStep("details");
    setError("");
    setNotice("");
    setOtp("");
    setSignupDetails(null);
    setFullName("");
    setUid("");
  }

  async function requestOtp(phone: string, targetMode: AuthMode, details?: SignupDetails) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const options: {
        shouldCreateUser: boolean;
        data?: { uid: string; full_name: string };
      } = { shouldCreateUser: targetMode === "up" };

      if (targetMode === "up" && details) {
        options.data = { uid: details.uid, full_name: details.fullName };
      }

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

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const phone = normalizePhoneNumber(phoneInput);
    if (!phone) {
      setError("Enter a valid mobile number. Indian numbers can be entered as 10 digits; other countries need a +country code.");
      return;
    }

    if (mode === "up") {
      const normalizedUid = normalizeUid(uid);
      const name = fullName.trim();
      if (!name || name.length > 80) {
        setError("Enter your full name (up to 80 characters).");
        return;
      }
      if (!isValidUid(normalizedUid)) {
        setError("Enter a valid university ID (5–20 letters and numbers only).");
        return;
      }

      const details = { uid: normalizedUid, fullName: name };
      setSignupDetails(details);
      await requestOtp(phone, mode, details);
      return;
    }

    await requestOtp(phone, mode);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const token = otp.trim();
    if (!isValidOtp(token)) {
      setError("Enter the six-digit code from your SMS.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: phoneForOtp,
        token,
        type: "sms",
      });

      if (verifyError || !data.session) {
        setError("We couldn't verify that code. Check the digits or request a new code. For sign-up, your UID must also be unused.");
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
      }

      navigate({ to: redirect, replace: true });
    } catch {
      setError("Something went wrong while verifying the code. Please try again.");
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
              <span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800">
                <Smartphone size={27} />
              </span>
              <p className="mt-6 kicker text-emerald-800">Phone verification</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Check your phone
              </h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Enter the six-digit code sent to <strong className="text-foreground">{phoneForOtp}</strong>{" "}
                to {mode === "in" ? "sign in" : "finish creating your account"}.
              </p>
              <form onSubmit={verifyCode} className="mt-6">
                <label className="block text-sm font-extrabold text-foreground">
                  Verification code
                  <input
                    required
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    className={field}
                  />
                </label>
                {notice && (
                  <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold leading-6 text-emerald-900">
                    {notice}
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-bold leading-6 text-destructive">
                    {error}
                  </p>
                )}
                <button
                  disabled={busy}
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Verifying…" : mode === "in" ? "Verify & sign in" : "Verify & create account"}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  disabled={busy}
                  onClick={changePhoneNumber}
                  className="inline-flex items-center gap-2 font-extrabold text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  <ArrowLeft size={15} /> Change number
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void requestOtp(phoneForOtp, mode, signupDetails ?? undefined)}
                  className="font-extrabold text-primary underline-offset-4 hover:underline disabled:opacity-60"
                >
                  Resend code
                </button>
              </div>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-emerald-800" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Never share your verification code with anyone, including someone claiming to be
                  from CampusFind.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="kicker text-emerald-800">Student access</p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                  {mode === "in" ? "Sign in with phone" : "Create account"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {mode === "in"
                    ? "Enter your mobile number and we'll send you a one-time code."
                    : "Add your student details, then verify your mobile number to create the account."}
                </p>
              </div>

              <div className="mt-7 grid grid-cols-2 rounded-xl bg-secondary p-1">
                {([["in", "Sign in"], ["up", "Create account"]] as const).map(([nextMode, label]) => (
                  <button
                    type="button"
                    key={nextMode}
                    onClick={() => switchMode(nextMode)}
                    aria-pressed={mode === nextMode}
                    className={`rounded-lg px-3 py-2.5 text-sm font-extrabold transition ${mode === nextMode ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={submitDetails} className="mt-6">
                {mode === "up" && (
                  <>
                    <label className="mb-4 block text-sm font-extrabold text-foreground">
                      Student name
                      <input
                        required
                        name="full_name"
                        maxLength={80}
                        autoComplete="name"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Your full name"
                        className={field}
                      />
                    </label>
                    <label className="mb-4 block text-sm font-extrabold text-foreground">
                      Student UID
                      <input
                        required
                        name="uid"
                        maxLength={20}
                        autoComplete="username"
                        autoCapitalize="characters"
                        value={uid}
                        onChange={(event) => setUid(event.target.value.toUpperCase())}
                        placeholder="e.g. 26BCS11930"
                        className={`${field} uppercase`}
                      />
                    </label>
                  </>
                )}

                <label className="block text-sm font-extrabold text-foreground">
                  Student phone number
                  <input
                    required
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={24}
                    value={phoneInput}
                    onChange={(event) => setPhoneInput(event.target.value)}
                    placeholder="98765 43210"
                    className={field}
                  />
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Indian mobile numbers can be entered as 10 digits. For another country, include the
                  +country code.
                </p>

                {error && (
                  <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-bold leading-6 text-destructive">
                    {error}
                  </p>
                )}
                <button
                  disabled={busy}
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy
                    ? "Please wait…"
                    : mode === "in"
                      ? "Send sign-in code"
                      : "Send verification code"}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </form>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-emerald-800" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Phone OTP confirms access to a mobile number. Keep your UID accurate and never share
                  verification codes.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}
