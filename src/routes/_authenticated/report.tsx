import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Page } from "@/components/site";
import { CATEGORIES, type Item } from "@/lib/items";
import { findItemMatches } from "@/lib/match-score";
import { isValidIsoDate } from "@/lib/date";
import { validateItemImage } from "@/lib/item-image";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report a lost or found item — CampusFind" },
      { name: "description", content: "Report a lost or found item on campus in under a minute." },
      { property: "og:title", content: "Report an item — CampusFind" },
      { property: "og:description", content: "Report a lost or found item on campus in under a minute." },
    ],
  }),
  component: Report,
});

const field = "mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring";

function Report() {
  const [type, setType] = useState<"Lost" | "Found">("Lost");
  const [done, setDone] = useState(false);
  const [matches, setMatches] = useState<Array<{ item: Item; score: number }>>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");

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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "");
    const location = String(form.get("location") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const note = String(form.get("note") ?? "").trim();
    const phoneNumber = String(form.get("phone_number") ?? "").trim();
    const smsEnabled = form.get("sms_notifications_enabled") === "on";

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
    if (!location || location.length > 160) {
      setError("Enter a location (up to 160 characters).");
      setBusy(false);
      return;
    }
    if (!isValidIsoDate(date)) {
      setError("Choose a valid date.");
      setBusy(false);
      return;
    }
    if (phoneNumber && !/^\+?[1-9]\d{9,14}$/.test(phoneNumber)) {
      setError("Enter a valid phone number with country code, for example +919876543210.");
      setBusy(false);
      return;
    }
    if (note.length > 500) {
      setError("Description must be 500 characters or fewer.");
      setBusy(false);
      return;
    }

    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u.user) {
        setError("Please sign in again.");
        return;
      }
      if (phoneNumber) {
        const { error: profileError } = await supabase.from("notification_preferences").upsert({ user_id: u.user.id, phone_number: phoneNumber, sms_notifications_enabled: smsEnabled, updated_at: new Date().toISOString() });
        if (profileError) {
          setError("Your report setup needs the latest CampusFind database update. Please try again after the update is applied.");
          return;
        }
      }
      let imagePath: string | null = null;
      if (imageFile) {
        const imageValidationError = validateItemImage(imageFile);
        if (imageValidationError) {
          setError(imageValidationError);
          return;
        }
        const extension = imageFile.type === "image/jpeg" ? "jpg" : imageFile.type === "image/png" ? "png" : "webp";
        imagePath = `${u.user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("item-images").upload(imagePath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (uploadError) {
          imagePath = null;
          setError("Could not upload the image. Please check the storage setup and try again.");
          return;
        }
      }

      const { data: insertedItem, error: insertError } = await supabase.from("items").insert({
        user_id: u.user.id, type, name, category, location, item_date: date, note,
        ...(imagePath ? { image_path: imagePath } : {}),
      }).select("id").single();
      if (insertError) {
        if (imagePath) await supabase.storage.from("item-images").remove([imagePath]);
        setError("Could not save your report. Please check your connection and try again.");
        return;
      }
      // SMS is sent only when provider secrets are configured and the student opted in.
      if (insertedItem?.id) void supabase.functions.invoke("notify-item-matches", { body: { item_id: insertedItem.id } }).catch(() => undefined);
      setImageFile(null);
      setImagePreview("");
      try {
        const { data: rows } = await supabase.from("items").select("*").eq("type", type === "Lost" ? "Found" : "Lost").neq("user_id", u.user.id).limit(100);
        const freshItem: Item = { id: "new-report", user_id: u.user.id, type, name, category, location, item_date: date, note };
        setMatches(findItemMatches(freshItem, (rows ?? []) as Item[]));
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
      <section className="mx-auto grid max-w-6xl gap-16 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
        <div>
          <p className="kicker text-muted-foreground">Takes under a minute</p>
          <h1 className="mt-4 text-6xl leading-tight">Report an item</h1>
          <p className="mt-6 text-muted-foreground">Keep one identifying detail to yourself — it's how we'll verify the real owner before any handoff.</p>
        </div>
        {done ? (
          <div className="rounded-3xl bg-gradient-ink p-10 text-ink-foreground">
            <h2 className="text-4xl">Report received.</h2>
            <p className="mt-4 opacity-80">Your report is on the board. CampusFind checks for similar reports and creates alerts when a likely match is found.</p>
            {matches.length > 0 && <div className="mt-6 rounded-2xl bg-background/10 p-5"><h3 className="text-xl font-semibold">Possible matches found</h3><ul className="mt-3 space-y-3">{matches.map(({ item, score }) => <li key={item.id} className="rounded-xl border border-ink-foreground/20 p-3"><p className="font-medium">{item.name}</p><p className="mt-1 text-sm opacity-80">{item.type} · {item.category} · {item.location}</p><p className="mt-1 text-xs opacity-70">Similarity score: {score}% · Verify details before claiming</p></li>)}</ul></div>}
            {matches.length === 0 && <p className="mt-3 text-sm opacity-75">No strong match yet. If a similar report is added later, CampusFind can create a notification.</p>}
            <p className="mt-3 text-xs opacity-70">SMS alerts require the university project’s SMS gateway to be configured. In-app match alerts are recorded in CampusFind.</p>
            <div className="mt-8 flex gap-3">
              <Link to="/browse" className="rounded-full bg-accent px-6 py-3 font-medium text-accent-foreground">View the board</Link>
              <button onClick={() => setDone(false)} className="rounded-full border border-ink-foreground/30 px-6 py-3">Report another</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-3xl border border-border bg-card p-8 shadow-soft">
            <div className="grid grid-cols-2 gap-2 rounded-full bg-secondary p-1">
              {(["Lost", "Found"] as const).map((t) => (
                <button type="button" key={t} onClick={() => setType(t)} className={`rounded-full py-2 text-sm font-medium ${type === t ? "bg-primary text-primary-foreground" : ""}`}>I {t.toLowerCase()} something</button>
              ))}
            </div>
            <label className="mt-6 block text-sm font-medium">Item<input required name="name" placeholder="e.g. Black leather wallet" className={field} /></label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Category<select name="category" className={field}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="block text-sm font-medium">Date<input required type="date" name="date" className={field} /></label>
            </div>
            <label className="mt-4 block text-sm font-medium">Location<input required name="location" placeholder="e.g. Central Library" className={field} /></label>
            <div className="mt-4 rounded-2xl border border-border p-4"><label className="block text-sm font-medium">Mobile number for match alerts (optional)<input name="phone_number" type="tel" inputMode="tel" autoComplete="tel" placeholder="+919876543210" className={field} /><span className="mt-1 block text-xs text-muted-foreground">Use country code. Your number is stored privately in your student profile, not on the public report.</span></label><label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" name="sms_notifications_enabled" className="mt-1" /><span>I consent to SMS alerts about possible item matches.</span></label></div>
            <label className="mt-4 block text-sm font-medium">Item photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handleImageChange(e.currentTarget.files?.[0] ?? null)} className={field} /><span className="mt-1 block text-xs text-muted-foreground">JPG, PNG, or WebP · up to 5 MB</span></label>
            {imagePreview && <div className="mt-3"><img src={imagePreview} alt="Preview of the item being reported" className="max-h-64 w-full rounded-xl border border-border object-contain" /><button type="button" onClick={() => { setImageFile(null); setImagePreview(""); }} className="mt-2 text-sm text-muted-foreground underline">Remove photo</button></div>}
            <label className="mt-4 block text-sm font-medium">Public description<textarea name="note" rows={3} maxLength={500} placeholder="Avoid details that prove ownership" className={field} /></label>
            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
            <button disabled={busy} className="mt-6 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Saving report…" : "Submit report"}</button>
          </form>
        )}
      </section>
    </Page>
  );
}
