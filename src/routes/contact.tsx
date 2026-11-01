import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, LifeBuoy, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/contact")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: "/contact" } });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.role === "admin") throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: [
      { title: "Help & Support — CampusFind" },
      { name: "description", content: "Send a message to the CampusFind administrators and follow replies in your account." },
      { property: "og:title", content: "Help & Support — CampusFind" },
      { property: "og:description", content: "Get help from the CampusFind administrator team without email." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContactPage,
});

const field =
  "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/15";

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type SupportTicket = {
  id: string;
  user_id: string;
  subject: string;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
};

function ContactPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again to view your support messages.");

      const { data: ticketRows, error: ticketError } = await supabase
        .from("support_tickets")
        .select("id,user_id,subject,status,created_at,updated_at")
        .eq("user_id", authData.user.id)
        .order("updated_at", { ascending: false });
      if (ticketError) throw ticketError;

      const rows = ticketRows ?? [];
      if (!rows.length) {
        setTickets([]);
        return;
      }

      const { data: messageRows, error: messagesError } = await supabase
        .from("support_messages")
        .select("id,ticket_id,sender_id,body,created_at")
        .in("ticket_id", rows.map((ticket) => ticket.id))
        .order("created_at", { ascending: true });
      if (messagesError) throw messagesError;

      const byTicket = new Map<string, SupportMessage[]>();
      for (const row of (messageRows ?? []) as SupportMessage[]) {
        const bucket = byTicket.get(row.ticket_id) ?? [];
        bucket.push(row);
        byTicket.set(row.ticket_id, bucket);
      }
      setTickets(rows.map((ticket) => ({
        ...ticket,
        status: ticket.status as SupportTicket["status"],
        messages: byTicket.get(ticket.id) ?? [],
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't load your support messages. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (cleanSubject.length < 3 || cleanSubject.length > 160) {
      setError("The subject must be between 3 and 160 characters.");
      return;
    }
    if (cleanMessage.length < 10 || cleanMessage.length > 5000) {
      setError("Your message must be between 10 and 5,000 characters.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: createError } = await supabase.rpc("create_support_ticket", {
        p_subject: cleanSubject,
        p_message: cleanMessage,
      });
      if (createError || !data) throw createError ?? new Error("The message could not be created.");
      setSubject("");
      setMessage("");
      setNotice("Your message has been sent. The administrator team can reply here.");
      await loadTickets();
    } catch {
      setError("We couldn't send your message. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(ticketId: string) {
    const body = (replyDrafts[ticketId] ?? "").trim();
    if (!body || busyTicket) return;
    setError("");
    setNotice("");
    setBusyTicket(ticketId);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again.");
      const { error: insertError } = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_id: authData.user.id,
        body,
      });
      if (insertError) throw insertError;
      setReplyDrafts((current) => ({ ...current, [ticketId]: "" }));
      setNotice("Your reply has been sent.");
      await loadTickets();
    } catch {
      setError("We couldn't send your reply. Please try again.");
    } finally {
      setBusyTicket(null);
    }
  }

  return (
    <Page>
      <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <nav aria-label="Breadcrumb" className="mb-7 text-sm text-muted-foreground">
          <Link to="/browse" className="font-bold text-primary hover:underline">Browse</Link>
          <span className="px-2" aria-hidden="true">/</span>
          <span aria-current="page">Help & Support</span>
        </nav>

        <div className="rounded-[2rem] border border-border bg-white p-6 shadow-sm sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-secondary text-primary"><LifeBuoy size={22} /></span>
              <div>
                <p className="kicker text-emerald-800">CampusFind support</p>
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">How can we help?</h1>
                <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Send an issue or question directly to the administrator team. Your conversation and every reply stay inside CampusFind—no email address required.</p>
              </div>
            </div>
            <button type="button" onClick={() => void loadTickets()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-50">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          {notice && <p role="status" className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-900/10 bg-emerald-50 p-4 text-sm font-bold leading-6 text-emerald-900"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</p>}
          {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold leading-6 text-destructive">{error}</p>}

          <form onSubmit={submitTicket} className="mt-8 rounded-2xl border border-border bg-background p-5 sm:p-6">
            <div className="flex items-center gap-2"><MessageCircle size={18} className="text-primary" /><h2 className="text-lg font-extrabold text-foreground">Start a new conversation</h2></div>
            <label className="mt-5 block text-sm font-extrabold text-foreground">Issue or subject
              <input required minLength={3} maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Trouble submitting a found item" className={field} />
            </label>
            <label className="mt-4 block text-sm font-extrabold text-foreground">Describe the issue
              <textarea required minLength={10} maxLength={5000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what happened and how we can help…" className={field + " resize-y leading-6"} />
            </label>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Do not include passwords, OTPs, or private proof-of-ownership details.</p>
            <button type="submit" disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Sending…" : "Send to administrator"} {!busy && <Send size={16} />}
            </button>
          </form>

          <div className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="kicker text-emerald-800">Your inbox</p><h2 className="mt-2 text-2xl font-extrabold text-foreground">Your support conversations</h2><p className="mt-1 text-sm text-muted-foreground">Administrator replies appear here. You can continue the conversation at any time.</p></div>
              <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold text-secondary-foreground">{tickets.length} {tickets.length === 1 ? "conversation" : "conversations"}</span>
            </div>
            {loading ? (
              <p role="status" className="mt-5 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Loading your conversations…</p>
            ) : tickets.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-border p-7 text-center">
                <MessageCircle size={25} className="mx-auto text-muted-foreground" />
                <p className="mt-3 font-extrabold text-foreground">No conversations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Send a message above and the administrator team will reply here.</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                {tickets.map((ticket) => (
                  <article key={ticket.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                      <div><h3 className="font-extrabold text-foreground">{ticket.subject}</h3><p className="mt-1 text-xs text-muted-foreground">Started {new Date(ticket.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p></div>
                      <span className={ticket.status === "open" ? "rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-800" : "rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold text-secondary-foreground"}>{ticket.status === "open" ? "Open" : "Resolved"}</span>
                    </div>
                    <div className="grid gap-3 bg-background p-4 sm:p-5">
                      {ticket.messages.map((entry) => {
                        const fromAdmin = entry.sender_id !== ticket.user_id;
                        return (
                          <div key={entry.id} className={fromAdmin ? "ml-0 mr-6 rounded-xl border border-emerald-900/10 bg-emerald-50 p-4 sm:mr-16" : "ml-6 rounded-xl border border-border bg-white p-4 sm:ml-16"}>
                            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-extrabold text-foreground">{fromAdmin ? "CampusFind Administrator" : "You"}</p><time className="text-[11px] text-muted-foreground" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{entry.body}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="border-t border-border p-4 sm:p-5">
                      <label className="block text-xs font-extrabold text-muted-foreground">YOUR REPLY
                        <textarea rows={2} maxLength={5000} value={replyDrafts[ticket.id] ?? ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Write a reply…" className={field + " resize-y"} />
                      </label>
                      <button type="button" disabled={busyTicket === ticket.id || !(replyDrafts[ticket.id] ?? "").trim()} onClick={() => void sendReply(ticket.id)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-extrabold text-foreground hover:bg-secondary disabled:opacity-50">{busyTicket === ticket.id ? "Sending…" : "Send reply"} <Send size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end"><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-extrabold text-primary hover:bg-secondary"><ArrowLeft size={16} /> Back to CampusFind</Link></div>
      </section>
    </Page>
  );
}
