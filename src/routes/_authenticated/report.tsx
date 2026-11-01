import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, BellRing, Camera, CheckCircle2, Copy, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { Page } from "@/components/site";
import { CATEGORIES, type Item } from "@/lib/items";
import { explainItemMatch, findItemMatches } from "@/lib/match-score";
import { isValidIsoDate } from "@/lib/date";
import { compressItemImage, validateItemImage } from "@/lib/item-image";
import { CAMPUS_LOCATIONS, buildCampusLocation, type CampusLocation } from "@/lib/campus-locations";
import { buildNotificationPreferencePayload, validateNotificationPreference } from "@/lib/notification-preferences";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report a lost or found item — CampusFind" },
      { name: "description", content: "Report a lost or found item on campus in under a minute." },
      { property: "og:title", content: "Report an item — CampusFind" },
      { property: "og:description", content: "Report a lost or found item on campus in under a minute." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Report,
});

const field = "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3.5 text-sm transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60";

function Report() {
  const [type, setType] = useState<"Lost" | "Found">("Lost");
  const [done, setDone] = useState(false);
  const [reportId, setReportId] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [matches, setMatches] = useState<Array<{ item: Item; score: number; reasons: string[] }>>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesAvailable, setPreferencesAvailable] = useState(true);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [accountState, setAccountState] = useState<"checking" | "student" | "not-student" | "unavailable">("checking");

  useEffect(() => {
    let cancelled = false;
    async function checkStudentAccount() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error("Sign-in required.");
        const { data: profile, error: profileError } = await supabase
          .from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
        if (profileError || !profile) throw new Error("Could not check this account.");
        if (!cancelled) setAccountState(profile.role === "student" ? "student" : "not-student");
      } catch {
        if (!cancelled) setAccountState("unavailable");
      }
    }
    void checkStudentAccount();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotificationPreferences() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error("Could not read the current user.");

        const { data, error: preferencesError } = await supabase
          .from("notification_preferences")
          .select("phone_number,sms_notifications_enabled")
          .eq("user_id", authData.user.id)
          .maybeSingle();
        if (preferencesError) throw preferencesError;

        if (!cancelled && data) {
          setPhoneNumber(data.phone_number ?? "");
          setSmsEnabled(Boolean(data.sms_notifications_enabled));
        }
      } catch {
        // SMS preferences are optional; this must not block basic item reporting.
        if (!cancelled) setPreferencesAvailable(false);
      } finally {
        if (!cancelled) setPreferencesLoading(false);
      }
    }

    void loadNotificationPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function handleImageChange(file: File | null) {
    setError("");
    if (!file) {
      setImageFile(null);
      setImagePreview("");
      return;
    }
    setImageFile(null);
    setImagePreview("");
    const validationError = validateItemImage(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportStep, setReportStep] = useState(1);
  const reportFormRef = useRef<HTMLFormElement>(null);

  async function copyReportReference() {
    if (!reportId) return;
    try {
      await navigator.clipboard.writeText(reportId);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Select the ID to copy");
    }
  }

  function continueToNextStep() {
    const panel = reportFormRef.current?.querySelector<HTMLElement>(`[data-report-panel="${reportStep}"]`);
    const requiredFields = panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[required]") ?? [];
    for (const fieldElement of requiredFields) {
      if (!fieldElement.checkValidity()) {
        fieldElement.reportValidity();
        fieldElement.focus();
        return;
      }
    }
    setError("");
    setReportStep((current) => Math.min(4, current + 1));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "");
    const locationZone = String(form.get("location_zone") ?? "") as CampusLocation;
    const locationDetail = String(form.get("location_detail") ?? "").trim();
    const location = CAMPUS_LOCATIONS.includes(locationZone) ? buildCampusLocation(locationZone, locationDetail) : "";
    const date = String(form.get("date") ?? "");
    const note = String(form.get("note") ?? "").trim();
    const brand = String(form.get("brand") ?? "").trim();
    const color = String(form.get("color") ?? "").trim();
    const model = String(form.get("model") ?? "").trim();
    const itemTime = String(form.get("item_time") ?? "");
    const submittedPhoneNumber = phoneNumber.trim();
    const submittedSmsEnabled = smsEnabled;

    if (!name || name.length > 120) {
      setError("Enter an item name (up to 120 characters).");
      setBusy(false);
      return;
    }
    if (!CATEGORIES.includes(category)) {
      setError("Choose a valid category.");
      setBusy(false);
      return;
    }
    if (!CAMPUS_LOCATIONS.includes(locationZone) || (locationZone === "Other campus location" && !locationDetail)) {
      setError("Choose a campus area and add a landmark when selecting Other campus location.");
      setBusy(false);
      return;
    }
    if (!location || location.length > 160) {
      setError("Keep the campus area and landmark within 160 characters.");
      setBusy(false);
      return;
    }
    if (!isValidIsoDate(date)) {
      setError("Choose a valid date.");
      setBusy(false);
      return;
    }
    if (preferencesDirty && preferencesAvailable) {
      const preferenceError = validateNotificationPreference(submittedPhoneNumber, submittedSmsEnabled);
      if (preferenceError) {
        setError(preferenceError);
        setBusy(false);
        return;
      }
    }
    if (note.length > 500 || brand.length > 80 || color.length > 50 || model.length > 80) {
      setError("Keep the description within 500 characters, brand/model within 80, and colour within 50.");
      setBusy(false);
      return;
    }
    if (itemTime && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(itemTime)) {
      setError("Choose a valid approximate time or leave it blank.");
      setBusy(false);
      return;
    }

    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u.user) {
        setError("Please sign in again.");
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      if (profileError || !profile) {
        setError("We couldn't check this student account. Refresh the page and try again.");
        return;
      }
      if (profile.role !== "student") {
        setError("Only student accounts can submit reports.");
        return;
      }
      if (preferencesDirty && preferencesAvailable) {
        const { error: preferenceSaveError } = await supabase
          .from("notification_preferences")
          .upsert(buildNotificationPreferencePayload(u.user.id, submittedPhoneNumber, submittedSmsEnabled));
        if (preferenceSaveError) {
          setError("We couldn't update your SMS alert preference. Please try again.");
          return;
        }
        setPreferencesDirty(false);
      }
      let imagePath: string | null = null;
      if (imageFile) {
        const imageValidationError = validateItemImage(imageFile);
        if (imageValidationError) {
          setError(imageValidationError);
          return;
        }
        const uploadFile = await compressItemImage(imageFile);
        const uploadValidationError = validateItemImage(uploadFile);
        if (uploadValidationError) {
          setError(uploadValidationError);
          return;
        }
        const extension = uploadFile.type === "image/jpeg" ? "jpg" : uploadFile.type === "image/png" ? "png" : "webp";
        imagePath = `${u.user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("item-images").upload(imagePath, uploadFile, {
          contentType: uploadFile.type,
          upsert: false,
        });
        if (uploadError) {
          imagePath = null;
          setError("Could not upload the image. Please check the storage setup and try again.");
          return;
        }
      }

      const { data: insertedItem, error: insertError } = await supabase.from("items").insert({
        user_id: u.user.id, type, name, category, location, item_date: date, item_time: itemTime,
        brand, color, model, note,
        ...(imagePath ? { image_path: imagePath } : {}),
      }).select("id").single();
      if (insertError) {
        if (imagePath) await supabase.storage.from("item-images").remove([imagePath]);
        setError("Could not save your report. Please check your connection and try again.");
        return;
      }
      if (!insertedItem?.id) {
        setError("The report was saved without a report ID. Please refresh and check the board before trying again.");
        return;
      }

      setReportId(insertedItem.id);
      setCopyMessage("");

      // SMS is sent only when provider secrets are configured and the student opted in.
      void supabase.functions.invoke("notify-item-matches", { body: { item_id: insertedItem.id } }).catch(() => undefined);
      setImageFile(null);
      setImagePreview("");
      try {
        const { data: rows } = await supabase.from("items").select("*").eq("type", type === "Lost" ? "Found" : "Lost").neq("user_id", u.user.id).in("report_status", ["new", "under_review", "matched"]).eq("moderation_flag", "none").order("created_at", { ascending: false }).limit(150);
        const freshItem: Item = { id: "new-report", user_id: u.user.id, type, name, category, location, item_date: date, item_time: itemTime, brand, color, model, note };
        setMatches(findItemMatches(freshItem, (rows ?? []) as Item[]).map((match) => ({ ...match, reasons: explainItemMatch(freshItem, match.item) })));
      } catch {
        setMatches([]);
      }
      setDone(true);
    } catch {
      setError("Something went wrong while saving your report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[0.78fr_1.22fr] lg:gap-12 lg:py-14">
        <aside className="relative overflow-hidden rounded-[2rem] bg-gradient-ink p-7 text-ink-foreground sm:p-9 lg:sticky lg:top-28 lg:h-fit">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-white/85"><Sparkles size={14} className="text-emerald-200" /> Takes about a minute</span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight text-white sm:text-5xl">Help your item find its way back.</h1>
            <p className="mt-5 leading-7 text-white/70">A few clear details help others recognise a report. Share enough to search—but keep one identifying detail private for verification.</p>
            <div className="mt-8 space-y-4">
              <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><MapPin size={19} /></span><div><p className="text-sm font-extrabold text-white">Add a useful location</p><p className="mt-1 text-xs leading-5 text-white/60">Use a building, gate, lab, or another clear landmark.</p></div></div>
              <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><ShieldCheck size={19} /></span><div><p className="text-sm font-extrabold text-white">Protect proof of ownership</p><p className="mt-1 text-xs leading-5 text-white/60">Don't publish passwords, serials, or the only detail an owner can verify.</p></div></div>
            </div>
            <div className="mt-8 flex items-center gap-2 border-t border-white/10 pt-5 text-xs font-bold text-white/60"><CheckCircle2 size={16} className="text-emerald-200" /> Your report helps someone start looking.</div>
          </div>
        </aside>
        {accountState === "checking" ? (
          <div role="status" className="flex min-h-64 flex-col justify-center rounded-[2rem] border border-border bg-white p-7 shadow-xl shadow-primary/5 sm:p-10"><h2 className="text-2xl font-extrabold">Checking student account</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">This check confirms you are signed in with a student account. Administrator identity verification is not required to report an item.</p></div>
        ) : accountState !== "student" ? (
          <div className="flex min-h-64 flex-col justify-center rounded-[2rem] border border-border bg-white p-7 shadow-xl shadow-primary/5 sm:p-10"><p className="kicker text-primary">Student access</p><h2 className="mt-3 text-2xl font-extrabold">{accountState === "not-student" ? "A student account is required" : "Student account check unavailable"}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{accountState === "not-student" ? "Sign in with your student account to report a lost or found item. Student identity verification is not required for reporting." : "CampusFind could not check your student account. Refresh the page and try again."}</p><Link to="/browse" className="mt-6 inline-flex w-fit rounded-xl border border-border px-4 py-3 text-sm font-extrabold text-primary hover:bg-secondary">Back to reports</Link></div>
        ) : done ? (
          <div className="flex flex-col justify-center rounded-[2rem] border border-border bg-white p-7 shadow-xl shadow-primary/5 sm:p-10">
            <span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800"><CheckCircle2 size={30} /></span>
            <p className="mt-6 kicker text-emerald-800">Submission complete</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Report received.</h2>
            <p className="mt-4 max-w-xl leading-7 text-muted-foreground">Your report has been saved. You can track its progress in My Reports. CampusFind checks similar reports and may create alerts when a likely match is found.</p>
            <div className="cf-report-reference mt-6">
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Report reference</p>
                <code className="mt-2 block break-all text-sm font-extrabold text-foreground">{reportId || "Reference unavailable"}</code>
              </div>
              <button type="button" onClick={() => void copyReportReference()} disabled={!reportId} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-foreground hover:bg-secondary disabled:opacity-50">
                <Copy size={14} /> {copyMessage || "Copy ID"}
              </button>
            </div>
            {matches.length > 0 && <div className="mt-7 rounded-2xl border border-emerald-900/10 bg-emerald-50/60 p-5"><h3 className="text-lg font-extrabold">Possible matches</h3><ul className="mt-4 grid gap-3">{matches.map(({ item, score, reasons }) => <li key={item.id} className="rounded-xl border border-border bg-white p-4"><p className="font-extrabold text-foreground">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{item.type} · {item.category} · {item.location}</p><p className="mt-2 text-xs font-bold text-primary">Match signal: {score}%</p>{reasons.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground">Why it appeared: {reasons.join(" · ")}</p>}<p className="mt-2 text-xs font-semibold text-amber-800">Suggestion only — compare the details and verify ownership before arranging a return.</p></li>)}</ul></div>}
            {matches.length === 0 && <p className="mt-5 rounded-xl bg-secondary p-4 text-sm leading-6 text-muted-foreground">No strong match yet. If a similar report is added later, CampusFind can create a notification.</p>}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">SMS alerts require the project's SMS gateway to be configured. In-app match alerts are recorded in CampusFind.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/my-reports" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground">Track my report <ArrowRight size={16} /></Link>
              <Link to="/browse" className="rounded-xl border border-border px-5 py-3 text-sm font-extrabold text-foreground transition hover:bg-secondary">View the board</Link>
              <button type="button" onClick={() => { setError(""); setReportStep(1); setDone(false); setReportId(""); setCopyMessage(""); }} className="rounded-xl border border-border px-5 py-3 text-sm font-extrabold text-foreground transition hover:bg-secondary">Report another</button>
            </div>
          </div>
        ) : (
          <form ref={reportFormRef} noValidate onSubmit={submit} className="cf-report-wizard rounded-[2rem] border border-border bg-white p-5 shadow-xl shadow-primary/5 sm:p-8 lg:p-10">
            <div className="border-b border-border pb-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="kicker text-primary">New report</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Tell us what happened</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Complete four quick steps. Your entries stay here as you move between them.</p></div>
                <span className="rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground">Step {reportStep} of 4</span>
              </div>
              <ol className="cf-report-steps mt-6" aria-label="Report progress">
                {["Item", "Location", "Photo & alerts", "Review"].map((label, index) => (
                  <li key={label}><button type="button" disabled={index + 1 > reportStep} aria-current={reportStep === index + 1 ? "step" : undefined} onClick={() => setReportStep(index + 1)} className={reportStep === index + 1 ? "cf-report-step is-current" : reportStep > index + 1 ? "cf-report-step is-complete" : "cf-report-step"}><span>{reportStep > index + 1 ? "✓" : `0${index + 1}`}</span><span>{label}</span></button></li>
                ))}
              </ol>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={reportStep} aria-label="Report completion"><div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${reportStep * 25}%` }} /></div>
            </div>

            <div data-report-panel="1" hidden={reportStep !== 1} className="cf-report-panel">
              <fieldset className="mt-6"><legend className="mb-3 text-sm font-extrabold text-foreground">Are you reporting something lost or found?</legend><div className="grid grid-cols-2 gap-3">{(["Lost", "Found"] as const).map((t) => <button type="button" key={t} aria-pressed={type === t} onClick={() => setType(t)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition ${type === t ? "border-primary bg-primary text-white shadow-md shadow-primary/10" : "border-border bg-background text-muted-foreground hover:bg-secondary"}`}>{t === "Lost" ? "I lost an item" : "I found an item"}{type === t && <CheckCircle2 size={16} />}</button>)}</div></fieldset>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-extrabold text-foreground sm:col-span-2">Item name <span className="text-primary">*</span><input required name="name" maxLength={120} placeholder="e.g. Black leather wallet" className={field} /></label>
                <label className="block text-sm font-extrabold text-foreground">Category <span className="text-primary">*</span><select required name="category" className={field}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label className="block text-sm font-extrabold text-foreground">Date <span className="text-primary">*</span><input required type="date" name="date" className={field} /></label>
              </div>
            </div>

            <div data-report-panel="2" hidden={reportStep !== 2} className="cf-report-panel">
              <div className="mt-6 rounded-xl border border-border bg-background p-4 sm:p-5">
                <h3 className="text-sm font-extrabold text-foreground">Where and when was it last seen?</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">A precise campus area and approximate time help other students narrow their search.</p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <label className="block text-sm font-extrabold text-foreground">Approximate time <span className="font-semibold text-muted-foreground">(optional)</span><input type="time" name="item_time" className={field} /></label>
                  <label className="block text-sm font-extrabold text-foreground">Brand <span className="font-semibold text-muted-foreground">(optional)</span><input name="brand" maxLength={80} placeholder="e.g. Samsung" className={field} /></label>
                  <label className="block text-sm font-extrabold text-foreground">Colour <span className="font-semibold text-muted-foreground">(optional)</span><input name="color" maxLength={50} placeholder="e.g. Navy blue" className={field} /></label>
                  <label className="block text-sm font-extrabold text-foreground">Model <span className="font-semibold text-muted-foreground">(optional)</span><input name="model" maxLength={80} placeholder="e.g. Galaxy Buds FE" className={field} /></label>
                  <div className="block text-sm font-extrabold text-foreground sm:col-span-2">
                    <label htmlFor="location-zone">Campus area <span className="text-primary">*</span></label>
                    <select id="location-zone" required name="location_zone" defaultValue="" className={field}><option value="" disabled>Select a campus area</option>{CAMPUS_LOCATIONS.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>
                    <label htmlFor="location-detail" className="mt-3 block text-xs font-bold text-muted-foreground">More detail (optional, such as floor, room or nearby landmark)</label>
                    <input id="location-detail" name="location_detail" maxLength={80} placeholder="e.g. Ground floor, near the help desk" className={field} />
                    <span className="mt-2 block text-xs font-medium text-muted-foreground">Choose a campus area first. Add a floor or landmark to help narrow the search.</span>
                  </div>
                </div>
              </div>
            </div>

            <div data-report-panel="3" hidden={reportStep !== 3} className="cf-report-panel">
              <label className="mt-6 block text-sm font-extrabold text-foreground">Public description <span className="font-semibold text-muted-foreground">(optional)</span><textarea name="note" rows={4} maxLength={500} placeholder="Colour, brand and general appearance. Keep one proof-of-ownership detail private." className={`${field} resize-y leading-6`} /><span className="mt-1 block text-xs font-semibold text-muted-foreground">Up to 500 characters. Don't include sensitive or unique identifying information.</span></label>
              <div className="cf-photo-drop mt-6 rounded-2xl border border-dashed border-border bg-background p-4 sm:p-5" role="region" aria-label="Item photograph upload" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); }} onDragLeave={(event) => { event.currentTarget.classList.remove("is-dragging"); }} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-dragging"); handleImageChange(event.dataTransfer.files?.[0] ?? null); }}>
                <label className="flex cursor-pointer items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><Camera size={20} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">Add an item photo <span className="font-semibold text-muted-foreground">(optional)</span></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Drop an image here or choose a file · JPG, PNG or WebP · 5 MB max</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handleImageChange(e.currentTarget.files?.[0] ?? null)} className="mt-3 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:font-extrabold file:text-white hover:file:bg-primary/90" /></span></label>
                {imagePreview && <div className="mt-4 rounded-xl border border-border bg-white p-3"><img src={imagePreview} alt="Preview of the item being reported" className="max-h-64 w-full rounded-lg object-contain" /><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 truncate text-xs font-semibold text-muted-foreground">{imageFile ? `${imageFile.name} · ${Math.max(1, Math.round(imageFile.size / 1024))} KB` : "Photo selected"} · Choose another file above to replace</p><button type="button" onClick={() => { setImageFile(null); setImagePreview(""); }} className="rounded-lg px-2 py-1 text-xs font-extrabold text-muted-foreground hover:bg-secondary hover:text-foreground">Remove photo</button></div></div>}
              </div>
              <div className="mt-6 rounded-2xl border border-border bg-background p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><BellRing size={18} /></span><div><p className="text-sm font-extrabold text-foreground">SMS match alerts <span className="font-semibold text-muted-foreground">(optional)</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">Your number is stored privately and only used for alerts when you explicitly consent.</p></div></div>{preferencesLoading && <p className="mt-3 text-xs text-muted-foreground">Loading saved SMS preferences…</p>}{!preferencesLoading && !preferencesAvailable && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">SMS settings are temporarily unavailable. You can still submit this report; saved preferences haven't been changed.</p>}<label className="mt-4 block text-sm font-extrabold text-foreground">Mobile number<input name="phone_number" type="tel" inputMode="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => { setPhoneNumber(e.target.value); setPreferencesDirty(true); }} disabled={preferencesLoading || !preferencesAvailable} placeholder="+919876543210" className={field} /></label><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-white p-3 text-sm"><input type="checkbox" name="sms_notifications_enabled" checked={smsEnabled} onChange={(e) => { const enabled = e.target.checked; setSmsEnabled(enabled); setPreferencesDirty(true); if (!enabled) setPhoneNumber(""); }} disabled={preferencesLoading || !preferencesAvailable} className="mt-1 size-4 accent-primary" /><span><span className="block font-extrabold text-foreground">I consent to SMS alerts</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">You can opt out by unchecking this at any time.</span></span></label></div>
            </div>

            <div data-report-panel="4" hidden={reportStep !== 4} className="cf-report-panel mt-6">
              <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
                <p className="kicker text-primary">Final check</p><h3 className="mt-2 text-xl font-extrabold text-foreground">Review your report before sending</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Make sure the item, date and campus area are correct. Keep one identifying detail private.</p>
                <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-white p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Report type</dt><dd className="mt-1 text-sm font-bold">{type}</dd></div>
                  <div className="rounded-lg bg-white p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Item</dt><dd className="mt-1 text-sm font-bold">{reportFormRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.value || "Not entered"}</dd></div>
                  <div className="rounded-lg bg-white p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Category</dt><dd className="mt-1 text-sm font-bold">{reportFormRef.current?.querySelector<HTMLSelectElement>('[name="category"]')?.value || "Not selected"}</dd></div>
                  <div className="rounded-lg bg-white p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Date</dt><dd className="mt-1 text-sm font-bold">{reportFormRef.current?.querySelector<HTMLInputElement>('[name="date"]')?.value || "Not selected"}</dd></div>
                  <div className="rounded-lg bg-white p-3 sm:col-span-2"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Campus area</dt><dd className="mt-1 text-sm font-bold">{reportFormRef.current?.querySelector<HTMLSelectElement>('[name="location_zone"]')?.value || "Not selected"}{reportFormRef.current?.querySelector<HTMLInputElement>('[name="location_detail"]')?.value ? ` · ${reportFormRef.current?.querySelector<HTMLInputElement>('[name="location_detail"]')?.value}` : ""}</dd></div>
                </dl>
              </div>
            </div>
            {error && <p role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold leading-6 text-destructive">{error}</p>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              {reportStep > 1 ? <button type="button" onClick={() => { setError(""); setReportStep((step) => Math.max(1, step - 1)); }} className="rounded-lg border border-border px-4 py-3 text-sm font-extrabold text-foreground hover:bg-secondary">Back</button> : <span />}
              {reportStep < 4 ? <button type="button" onClick={continueToNextStep} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-primary/90">Continue <ArrowRight size={17} /></button> : <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Saving your report…" : "Submit report"}{!busy && <ArrowRight size={17} />}</button>}
            </div>
            <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">By submitting, you agree to share these details with other CampusFind students.</p>
          </form>
        )}
      </section>
    </Page>
  );
}
