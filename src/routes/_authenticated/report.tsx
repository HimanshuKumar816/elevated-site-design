import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Page } from "@/components/site";
import { CATEGORIES } from "@/lib/items";
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

      const { error: insertError } = await supabase.from("items").insert({
        user_id: u.user.id, type, name, category, location, item_date: date, note,
        ...(imagePath ? { image_path: imagePath } : {}),
      });
      if (insertError) {
        if (imagePath) await supabase.storage.from("item-images").remove([imagePath]);
        setError("Could not save your report. Please check your connection and try again.");
        return;
      }
      setImageFile(null);
      setImagePreview("");
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
            <p className="mt-4 opacity-80">Your item is now on the board for every signed-in student to see.</p>
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
