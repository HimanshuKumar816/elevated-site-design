import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LogOut, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isAdminProfile } from "@/lib/auth-validation";
import { countReports, filterReports, type AdminReport, type ReportFilter } from "@/lib/admin-reports";
import type { ModerationFlag, ReportStatus } from "@/lib/items";

const PAGE_SIZE = 500;
const PROFILE_BATCH_SIZE = 100;

export const Route = createFileRoute("/_authenticated/admin")({
  // Client-side route guard improves UX; profile RLS and the trusted role column
  // remain the source of truth and prevent non-admin profile enumeration.
  beforeLoad: async () => {
    let allowed = false;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userError && userData.user) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userData.user.id)
          .maybeSingle();
        allowed = !profileError && isAdminProfile(profile);
      }
    } catch {
      allowed = false;
    }
    if (!allowed) throw redirect({ to: "/browse" });
  },
  head: () => ({
    meta: [
      { title: "Administrator dashboard — CampusFind" },
      { name: "description", content: "Review student verification, lost and found reports, claims, possible matches, and campus recovery activity." },
      { property: "og:title", content: "Administrator dashboard — CampusFind" },
      { property: "og:description", content: "Administrator workspace for reviewing campus lost and found reports, claims, and possible matches." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Row = AdminReport & {
  image_url?: string | null;
  submitter_role: string | null;
  report_status: ReportStatus;
  moderation_flag: ModerationFlag;
  moderated_at: string | null;
  moderated_by: string | null;
};

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name: string | null;
  sender_uid: string | null;
  sender_role: string | null;
};

type ContactMessage = {
  id: string;
  user_id: string;
  subject: string;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_uid: string | null;
  messages: SupportMessage[];
};

type LoginActivity = {
  id: string;
  user_id: string;
  login_method: string;
  logged_in_at: string;
  full_name: string | null;
  uid: string | null;
  role: string | null;
};

type StudentRecord = {
  id: string;
  uid: string;
  full_name: string;
  role: string;
  verification_status: "unverified" | "verified";
  verified_at: string | null;
  created_at: string;
};

type MatchItem = {
  id: string;
  user_id: string;
  type: "Lost" | "Found";
  name: string;
  category: string;
  location: string;
  item_date: string;
  item_time?: string;
  brand?: string;
  color?: string;
  model?: string;
  note: string | null;
  created_at: string;
  image_url: string | null;
  submitter_name: string | null;
  submitter_uid: string | null;
  submitter_verified: boolean;
  submitter_role: string | null;
};

type ItemMatch = {
  id: string;
  matched_at: string;
  score: number | null;
  matching_method: string;
  match_reason: string | null;
  review_status: string;
  admin_note: string | null;
  lost: MatchItem;
  found: MatchItem;
};

type ClaimRecord = {
  id: string;
  item_id: string;
  claimant_id: string;
  source_match_id: string | null;
  proof: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  item_name: string;
  item_location: string;
  item_owner_name: string | null;
  item_owner_uid: string | null;
  item_category: string | null;
  claimant_name: string | null;
  claimant_uid: string | null;
};

type ModerationNote = {
  id: string;
  item_id: string;
  actor_id: string;
  note: string;
  created_at: string;
};

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ReportFilter>({ query: "", type: "All", category: "All" });
  const [reportStatusFilter, setReportStatusFilter] = useState("All");
  const [lostReportPage, setLostReportPage] = useState(1);
  const [foundReportPage, setFoundReportPage] = useState(1);
  const [loginEvents, setLoginEvents] = useState<LoginActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState("");
  const [aiStatus, setAiStatus] = useState<"unknown" | "checking" | "ready" | "missing" | "unreachable">("unknown");
  const [aiStatusMessage, setAiStatusMessage] = useState("");
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState("");
  const [moderationNotes, setModerationNotes] = useState<ModerationNote[]>([]);
  const [moderationDrafts, setModerationDrafts] = useState<Record<string, string>>({});
  const [moderationFlagDrafts, setModerationFlagDrafts] = useState<Record<string, ModerationFlag>>({});
  const [claimDrafts, setClaimDrafts] = useState<Record<string, string>>({});
  const [claimHandoverCodeDrafts, setClaimHandoverCodeDrafts] = useState<Record<string, string>>({});
  const [studentPage, setStudentPage] = useState(1);
  const [matchDrafts, setMatchDrafts] = useState<Record<string, string>>({});
  const [reportActionError, setReportActionError] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([]);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactPage, setContactPage] = useState(1);
  const [contactReplyDrafts, setContactReplyDrafts] = useState<Record<string, string>>({});
  const [contactReplyBusyId, setContactReplyBusyId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [verificationBusyId, setVerificationBusyId] = useState<string | null>(null);
  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Clear this browser cache even if the remote logout request fails.
    }
    queryClient.clear();
    navigate({ to: "/admin-login", replace: true });
  }


  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Read in pages rather than silently stopping at the PostgREST row limit.
      const items: Array<{
        id: string;
        user_id: string;
        type: string;
        name: string;
        category: string;
        location: string;
        item_date: string;
        note: string;
        created_at: string;
        image_path: string | null;
        report_status: string;
        moderation_flag: string;
        moderated_at: string | null;
        moderated_by: string | null;
        updated_at: string;
      }> = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: itemsError } = await supabase
          .from("items")
          .select("*")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (itemsError) throw itemsError;
        const page = data ?? [];
        items.push(...page);
        if (page.length < PAGE_SIZE) break;
      }


      const userIds = [...new Set(items.map((item) => item.user_id))];
      const profiles = new Map<string, { uid: string; full_name: string; role: string }>();
      // Small batches keep URL/request sizes bounded even if the report list grows.
      for (let offset = 0; offset < userIds.length; offset += PROFILE_BATCH_SIZE) {
        const ids = userIds.slice(offset, offset + PROFILE_BATCH_SIZE);
        const { data, error: profilesError } = await supabase
          .from("profiles")
          .select("id,uid,full_name,role")
          .in("id", ids);
        if (profilesError) throw profilesError;
        for (const profile of data ?? []) {
          profiles.set(profile.id, { uid: profile.uid, full_name: profile.full_name, role: profile.role });
        }
      }

      const merged: Row[] = await Promise.all(
        items.map(async (item) => {
          const profile = profiles.get(item.user_id);
          let image_url: string | null = null;
          if (item.image_path) {
            try {
              const { data, error: imageError } = await supabase.storage
                .from("item-images")
                .createSignedUrl(item.image_path, 60 * 60);
              if (!imageError) image_url = data?.signedUrl ?? null;
            } catch {
              // An unavailable image should not hide the underlying report.
              image_url = null;
            }
          }
          return {
            ...item,
            note: item.note ?? null,
            image_path: item.image_path ?? null,
            submitter_name: profile?.full_name ?? null,
            submitter_uid: profile?.uid ?? null,
            submitter_role: profile?.role ?? null,
            report_status: (item.report_status ?? "new") as ReportStatus,
            moderation_flag: (item.moderation_flag ?? "none") as ModerationFlag,
            moderated_at: item.moderated_at ?? null,
            moderated_by: item.moderated_by ?? null,
            image_url,
          };
        }),
      );
      setRows(merged);
    } catch {
      setError("We couldn't load reports. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setLostReportPage(1);
    setFoundReportPage(1);
  }, [filter, reportStatusFilter]);

  const loadLoginActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const getEventsPage = (offset: number) => supabase
        .from("login_events")
        .select("id,user_id,login_method,logged_in_at")
        .order("logged_in_at", { ascending: false })
        .range(offset, offset + 99);
      const events: NonNullable<Awaited<ReturnType<typeof getEventsPage>>["data"]> = [];
      for (let offset = 0; ; offset += 100) {
        const { data: page, error: eventsError } = await getEventsPage(offset);
        if (eventsError) throw eventsError;
        events.push(...(page ?? []));
        if (!page || page.length < 100) break;
      }

      const userIds = [...new Set(events.map((event) => event.user_id))];
      const profilesById = new Map<string, { full_name: string; uid: string; role: string }>();
      for (let offset = 0; offset < userIds.length; offset += 100) {
        const ids = userIds.slice(offset, offset + 100);
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,uid,full_name,role")
          .in("id", ids);
        if (profilesError) throw profilesError;
        for (const profile of profiles ?? []) {
          profilesById.set(profile.id, { full_name: profile.full_name, uid: profile.uid, role: profile.role });
        }
      }

      const activity = events.map((event) => {
        const profile = profilesById.get(event.user_id);
        return { ...event, full_name: profile?.full_name ?? null, uid: profile?.uid ?? null, role: profile?.role ?? null };
      });
      setLoginEvents(activity.filter((event) => event.role === "student"));
      setActivityPage(1);
    } catch {
      setActivityError("We couldn't load recent sign-ins. Please retry.");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLoginActivity();
  }, [loadLoginActivity]);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError("");
    try {
      const getPairsPage = (offset: number) => supabase
        .from("item_matches")
        .select("id,lost_item_id,found_item_id,score,matching_method,match_reason,review_status,admin_note,created_at,reviewed_at")
        .neq("review_status", "resolved")
        .order("created_at", { ascending: false })
        .range(offset, offset + 99);
      const pairs: NonNullable<Awaited<ReturnType<typeof getPairsPage>>["data"]> = [];
      for (let offset = 0; ; offset += 100) {
        const { data: page, error: pairsError } = await getPairsPage(offset);
        if (pairsError) throw pairsError;
        pairs.push(...(page ?? []));
        if (!page || page.length < 100) break;
      }
      if (!pairs?.length) {
        setMatches([]);
        return;
      }

      const itemIds = [...new Set(pairs.flatMap((pair) => [pair.lost_item_id, pair.found_item_id]))];
      const { data: itemRows, error: itemsError } = await supabase
        .from("items")
        .select("id,user_id,type,name,category,location,item_date,item_time,brand,color,model,note,created_at,image_path")
        .in("id", itemIds);
      if (itemsError) throw itemsError;
      const profilesIds = [...new Set((itemRows ?? []).map((item) => item.user_id))];
      const profilesById = new Map<string, { full_name: string; uid: string; verified: boolean; role: string }>();
      if (profilesIds.length) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,full_name,uid,role,verification_status")
          .in("id", profilesIds);
        if (profilesError) throw profilesError;
        for (const profile of profiles ?? []) {
          profilesById.set(profile.id, {
            full_name: profile.full_name,
            uid: profile.uid,
            verified: profile.verification_status === "verified",
            role: profile.role,
          });
        }
      }

      const enriched = await Promise.all((itemRows ?? []).map(async (item) => {
        let image_url: string | null = null;
        if (item.image_path) {
          try {
            const { data, error: signedError } = await supabase.storage
              .from("item-images")
              .createSignedUrl(item.image_path, 60 * 60);
            if (!signedError) image_url = data?.signedUrl ?? null;
          } catch {
            image_url = null;
          }
        }
        const profile = profilesById.get(item.user_id);
        return {
          ...item,
          type: item.type as "Lost" | "Found",
          note: item.note ?? null,
          image_url,
          submitter_name: profile?.full_name ?? null,
          submitter_uid: profile?.uid ?? null,
          submitter_verified: profile?.verified ?? false,
          submitter_role: profile?.role ?? null,
        } satisfies MatchItem;
      }));
      const itemsById = new Map(enriched.map((item) => [item.id, item]));
      const result: ItemMatch[] = pairs.flatMap((pair) => {
        const lost = itemsById.get(pair.lost_item_id);
        const found = itemsById.get(pair.found_item_id);
        if (!lost || !found) return [];
        return [{
          id: pair.id,
          matched_at: pair.created_at,
          score: pair.score,
          matching_method: pair.matching_method,
          match_reason: pair.match_reason,
          review_status: pair.review_status,
          admin_note: pair.admin_note,
          lost,
          found,
        }];
      });
      setMatches(result);
    } catch {
      setMatchesError("We couldn't load possible item matches. Please retry.");
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => { void loadMatches(); }, [loadMatches]);

  const loadClaims = useCallback(async () => {
    setClaimsLoading(true);
    setClaimsError("");
    try {
      const getClaimsPage = (offset: number) => supabase
        .from("item_claims")
        .select("id,item_id,claimant_id,source_match_id,proof,status,admin_note,created_at,reviewed_at,item_name_snapshot,item_location_snapshot,item_category_snapshot")
        .order("created_at", { ascending: false })
        .range(offset, offset + 99);
      const claimRows: NonNullable<Awaited<ReturnType<typeof getClaimsPage>>["data"]> = [];
      for (let offset = 0; ; offset += 100) {
        const { data: page, error: claimError } = await getClaimsPage(offset);
        if (claimError) throw claimError;
        claimRows.push(...(page ?? []));
        if (!page || page.length < 100) break;
      }
      if (!claimRows?.length) {
        setClaims([]);
        return;
      }
      const itemIds = [...new Set(claimRows.map((claim) => claim.item_id))];
      const userIds = [...new Set(claimRows.map((claim) => claim.claimant_id))];
      const [itemsResult, claimantProfiles] = await Promise.all([
        supabase.from("items").select("id,user_id,name,location,category").in("id", itemIds),
        supabase.from("profiles").select("id,full_name,uid").in("id", userIds),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (claimantProfiles.error) throw claimantProfiles.error;
      const itemsById = new Map((itemsResult.data ?? []).map((item) => [item.id, item]));
      const owners = [...new Set((itemsResult.data ?? []).map((item) => item.user_id))];
      const ownerProfilesResult = owners.length
        ? await supabase.from("profiles").select("id,full_name,uid").in("id", owners)
        : { data: [], error: null };
      if (ownerProfilesResult.error) throw ownerProfilesResult.error;
      const profilesById = new Map([...(claimantProfiles.data ?? []), ...(ownerProfilesResult.data ?? [])].map((profile) => [profile.id, profile]));
      setClaims(claimRows.map((claim) => {
        const item = itemsById.get(claim.item_id);
        const claimant = profilesById.get(claim.claimant_id);
        const owner = item ? profilesById.get(item.user_id) : null;
        return {
          ...claim,
          item_name: claim.item_name_snapshot ?? item?.name ?? "Found item",
          item_location: claim.item_location_snapshot ?? item?.location ?? "Details unavailable",
          item_category: claim.item_category_snapshot ?? item?.category ?? null,
          item_owner_name: owner?.full_name ?? null,
          item_owner_uid: owner?.uid ?? null,
          claimant_name: claimant?.full_name ?? null,
          claimant_uid: claimant?.uid ?? null,
        };
      }) as ClaimRecord[]);
    } catch {
      setClaimsError("We couldn't load item claims. Please retry.");
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  useEffect(() => { void loadClaims(); }, [loadClaims]);

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError("");
    try {
      const getStudentsPage = (offset: number) => supabase
        .from("profiles")
        .select("id,uid,full_name,role,verification_status,verified_at,created_at")
        .eq("role", "student")
        .order("created_at", { ascending: false })
        .range(offset, offset + 249);
      const records: NonNullable<Awaited<ReturnType<typeof getStudentsPage>>["data"]> = [];
      for (let offset = 0; ; offset += 250) {
        const { data: page, error: queryError } = await getStudentsPage(offset);
        if (queryError) throw queryError;
        records.push(...(page ?? []));
        if (!page || page.length < 250) break;
      }
      setStudents(records as StudentRecord[]);
    } catch {
      setStudentsError("We couldn't load student verification records. Please retry.");
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  useEffect(() => { void loadStudents(); }, [loadStudents]);

  const loadModerationNotes = useCallback(async () => {
    const { data, error: notesError } = await supabase
      .from("admin_item_moderation_notes")
      .select("id,item_id,actor_id,note,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!notesError) setModerationNotes((data ?? []) as ModerationNote[]);
  }, []);

  useEffect(() => { void loadModerationNotes(); }, [loadModerationNotes]);

  const loadContactMessages = useCallback(async () => {
    setContactLoading(true);
    setContactError("");
    try {
      const { data: ticketRows, error: ticketsError } = await supabase
        .from("support_tickets")
        .select("id,user_id,subject,status,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (ticketsError) throw ticketsError;
      const tickets = ticketRows ?? [];
      if (!tickets.length) {
        setContactMessages([]);
        setContactPage(1);
        return;
      }

      const ticketIds = tickets.map((ticket) => ticket.id);
      const { data: messageRows, error: messagesError } = await supabase
        .from("support_messages")
        .select("id,ticket_id,sender_id,body,created_at")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (messagesError) throw messagesError;

      const senderIds = [...new Set([
        ...tickets.map((ticket) => ticket.user_id),
        ...(messageRows ?? []).map((message) => message.sender_id),
      ])];
      const { data: profileRows, error: profilesError } = await supabase
        .from("profiles")
        .select("id,full_name,uid,role")
        .in("id", senderIds);
      if (profilesError) throw profilesError;
      const profilesById = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));

      const messagesByTicket = new Map<string, SupportMessage[]>();
      for (const message of messageRows ?? []) {
        const profile = profilesById.get(message.sender_id);
        const entry: SupportMessage = {
          ...message,
          sender_name: profile?.full_name ?? null,
          sender_uid: profile?.uid ?? null,
          sender_role: profile?.role ?? null,
        };
        const entries = messagesByTicket.get(message.ticket_id) ?? [];
        entries.push(entry);
        messagesByTicket.set(message.ticket_id, entries);
      }

      setContactMessages(tickets.map((ticket) => {
        const profile = profilesById.get(ticket.user_id);
        return {
          ...ticket,
          status: ticket.status as ContactMessage["status"],
          user_name: profile?.full_name ?? null,
          user_uid: profile?.uid ?? null,
          messages: messagesByTicket.get(ticket.id) ?? [],
        };
      }));
      setContactPage(1);
    } catch {
      setContactError("We couldn't load support conversations. Please retry.");
    } finally {
      setContactLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContactMessages();
  }, [loadContactMessages]);

  async function sendContactReply(ticket: ContactMessage) {
    const body = (contactReplyDrafts[ticket.id] ?? "").trim();
    if (!body || contactReplyBusyId) return;
    setContactError("");
    setContactReplyBusyId(ticket.id);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Administrator session expired.");
      const { error: insertError } = await supabase.from("support_messages").insert({
        ticket_id: ticket.id,
        sender_id: authData.user.id,
        body,
      });
      if (insertError) throw insertError;
      setContactReplyDrafts((current) => ({ ...current, [ticket.id]: "" }));
      await loadContactMessages();
    } catch {
      setContactError("We couldn't send the reply. Please refresh and try again.");
    } finally {
      setContactReplyBusyId(null);
    }
  }

  async function setContactTicketStatus(ticket: ContactMessage, status: "open" | "resolved") {
    setContactError("");
    setContactReplyBusyId(ticket.id);
    try {
      const { error: updateError } = await supabase
        .from("support_tickets")
        .update({ status })
        .eq("id", ticket.id);
      if (updateError) throw updateError;
      await loadContactMessages();
    } catch {
      setContactError("We couldn't update this conversation. Please retry.");
    } finally {
      setContactReplyBusyId(null);
    }
  }

  async function adminActorId() {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw new Error("Your administrator session has expired.");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || profile?.role !== "admin") throw new Error("Administrator access is required.");
    return userData.user.id;
  }

  async function updateReportStatus(report: Row, status: ReportStatus) {
    setReportActionError("");
    setActionBusyId(report.id);
    try {
      const actorId = await adminActorId();
      const { error: updateError } = await supabase.from("items").update({
        report_status: status,
        moderated_by: actorId,
        moderated_at: new Date().toISOString(),
      }).eq("id", report.id);
      if (updateError) throw updateError;
      setRows((current) => current.map((row) => row.id === report.id ? { ...row, report_status: status } : row));
    } catch {
      setReportActionError("We couldn't update this report status. Check administrator access and try again.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function updateReportModeration(report: Row, flag: ModerationFlag) {
    setReportActionError("");
    const note = (moderationDrafts[report.id] ?? "").trim();
    if (flag !== "none" && (note.length < 3 || note.length > 1000)) {
      setReportActionError("Add a private reason of 3–1,000 characters before applying a moderation flag.");
      return;
    }
    if (note.length > 0 && (note.length < 3 || note.length > 1000)) {
      setReportActionError("Private moderation notes must be 3–1,000 characters.");
      return;
    }
    setActionBusyId(report.id);
    try {
      const actorId = await adminActorId();
      const { error: updateError } = await supabase.rpc("admin_update_item_moderation", {
        p_item_id: report.id,
        p_flag: flag,
        ...(note ? { p_note: note } : {}),
      });
      if (updateError) throw updateError;
      const moderatedAt = new Date().toISOString();
      setRows((current) => current.map((row) => row.id === report.id ? { ...row, moderation_flag: flag, moderated_by: actorId, moderated_at: moderatedAt } : row));
      setModerationDrafts((current) => ({ ...current, [report.id]: "" }));
      setModerationFlagDrafts((current) => { const next = { ...current }; delete next[report.id]; return next; });
      await loadModerationNotes();
    } catch {
      setReportActionError("We couldn't save the moderation update. Add a private reason for flagged reports and try again.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function testAiEngine() {
    setAiStatus("checking");
    setAiStatusMessage("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("notify-item-matches", {
        body: { action: "health" },
      });
      if (invokeError || !data?.ok) throw invokeError ?? new Error("AI health check failed");
      if (data.ai_configured && data.ai_reachable) {
        setAiStatus("ready");
        setAiStatusMessage(`Connected to ${data.model ?? "the AI matching model"}.`);
      } else if (!data.ai_configured) {
        setAiStatus("missing");
        setAiStatusMessage("GROQ_API_KEY is not configured. Matching will use the text-similarity fallback.");
      } else {
        setAiStatus("unreachable");
        setAiStatusMessage(`Groq Free Plan is configured, but the model check failed (${data.error_code ?? "connection error"}).`);
      }
    } catch {
      setAiStatus("unreachable");
      setAiStatusMessage("The AI matching service could not be reached. Check the function deployment and try again.");
    }
  }

  async function reviewMatch(match: ItemMatch, status: "rejected") {
    setReportActionError("");
    setActionBusyId(match.id);
    try {
      const adminNote = (matchDrafts[match.id] ?? "").trim();
      const { error: updateError } = await supabase.rpc("admin_reject_item_match", {
        p_match_id: match.id,
        ...(adminNote ? { p_admin_note: adminNote } : {}),
      });
      if (updateError) throw updateError;
      setMatchDrafts((current) => ({ ...current, [match.id]: "" }));
      await Promise.all([loadMatches(), load()]);
    } catch {
      setReportActionError("We couldn't dismiss that match. It may already have been reviewed or the reports may no longer be active.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function approveMatchForReturn(match: ItemMatch) {
    setReportActionError("");
    setActionBusyId(match.id);
    try {
      const adminNote = (matchDrafts[match.id] ?? "").trim();
      const { error: approvalError } = await supabase.rpc("admin_approve_item_match_for_return", {
        p_match_id: match.id,
        ...(adminNote ? { p_admin_note: adminNote } : {}),
      });
      if (approvalError) throw approvalError;
      setMatchDrafts((current) => ({ ...current, [match.id]: "" }));
      await Promise.all([loadMatches(), loadClaims(), load()]);
    } catch {
      setReportActionError("We couldn't approve this match for return. Confirm that both report owners are verified, the reports are still active, and neither report is already paired with another approved match.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function updateStudentVerification(student: StudentRecord, verified: boolean) {
    setStudentsError("");
    setVerificationBusyId(student.id);
    try {
      const { error: updateError } = await supabase.rpc("admin_set_student_verification", {
        p_user_id: student.id,
        p_verified: verified,
      });
      if (updateError) throw updateError;
      await loadStudents();
    } catch {
      setStudentsError("We couldn't update this verification status. Please confirm administrator access and try again.");
    } finally {
      setVerificationBusyId(null);
    }
  }

  async function reviewClaim(claim: ClaimRecord, status: "approved" | "rejected" | "completed") {
    setReportActionError("");
    const handoverCode = (claimHandoverCodeDrafts[claim.id] ?? "").trim().toUpperCase();
    if (status === "completed" && !/^[A-F0-9]{12}$/.test(handoverCode)) {
      setReportActionError("Enter the claimant’s 12-character handover code after checking it in person.");
      return;
    }
    setActionBusyId(claim.id);
    try {
      await adminActorId();
      const adminNote = (claimDrafts[claim.id] ?? "").trim();
      const { error: updateError } = await supabase.rpc("admin_review_item_claim", {
        p_claim_id: claim.id,
        p_status: status,
        ...(adminNote ? { p_admin_note: adminNote } : {}),
        ...(status === "completed" ? { p_handover_code: handoverCode } : {}),
      });
      if (updateError) throw updateError;
      setClaimDrafts((current) => ({ ...current, [claim.id]: "" }));
      setClaimHandoverCodeDrafts((current) => ({ ...current, [claim.id]: "" }));
      await Promise.all([loadClaims(), load(), loadMatches()]);
    } catch {
      setReportActionError(status === "completed"
        ? "The item could not be marked returned. Check the handover code and confirm the physical handover first."
        : "We couldn't save this claim decision. Please refresh and try again.");
    } finally {
      setActionBusyId(null);
    }
  }

  const counts = countReports(rows);
  const categories = useMemo(() => ["All", ...new Set(rows.map((report) => report.category))], [rows]);
  const input = "rounded-xl border border-input bg-background px-3 py-2.5 text-sm";

  const visibleLost = filterReports(rows.filter((report) => report.type === "Lost" && (reportStatusFilter === "All" || report.report_status === reportStatusFilter)), { ...filter, type: "All" });
  const visibleFound = filterReports(rows.filter((report) => report.type === "Found" && (reportStatusFilter === "All" || report.report_status === reportStatusFilter)), { ...filter, type: "All" });
  const pendingClaimsCount = claims.filter((claim) => claim.status === "pending").length;
  const pendingMatchesCount = matches.filter((match) => match.review_status === "pending").length;
  const pendingReportsCount = rows.filter((report) => ["new", "under_review"].includes(report.report_status)).length;
  const returnedReportsCount = rows.filter((report) => report.report_status === "returned").length;
  const recoveryRate = rows.length ? Math.round((returnedReportsCount / rows.length) * 100) : 0;
  const topLocations = useMemo(() => {
    const countsByLocation = new Map<string, number>();
    for (const report of rows) {
      const zone = ((report.location ?? "").split(" — ")[0] ?? "").trim() || "Other campus location";
      countsByLocation.set(zone, (countsByLocation.get(zone) ?? 0) + 1);
    }
    return [...countsByLocation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  const visibleStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    return students.filter((student) => !query || (student.full_name ?? "").toLowerCase().includes(query) || (student.uid ?? "").toLowerCase().includes(query));
  }, [students, studentQuery]);
  const studentPageCount = Math.max(1, Math.ceil(visibleStudents.length / 25));
  const pageStudents = visibleStudents.slice((studentPage - 1) * 25, studentPage * 25);
  const activityPageCount = Math.max(1, Math.ceil(loginEvents.length / 25));
  const pageLoginEvents = loginEvents.slice((activityPage - 1) * 25, activityPage * 25);
  const filteredContactMessages = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contactMessages;
    return contactMessages.filter((ticket) => [
      ticket.user_name ?? "",
      ticket.user_uid ?? "",
      ticket.subject,
      ticket.status,
      ...ticket.messages.map((entry) => entry.body),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [contactMessages, contactQuery]);
  const contactPageCount = Math.max(1, Math.ceil(filteredContactMessages.length / 25));
  const pageContactMessages = filteredContactMessages.slice((contactPage - 1) * 25, contactPage * 25);
  useEffect(() => { setStudentPage(1); }, [studentQuery]);
  useEffect(() => { setContactPage(1); }, [contactQuery]);

  const renderReportCard = (report: Row) => {
    const selectedFlag = moderationFlagDrafts[report.id] ?? report.moderation_flag;
    const moderationNote = (moderationDrafts[report.id] ?? "").trim();
    const moderationHasChanges = selectedFlag !== report.moderation_flag || moderationNote.length > 0;
    return (
    <article id={`report-${report.id}`} key={report.id} className="interactive-card grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-[96px_1fr]">
      {report.image_url ? (
        <img src={report.image_url} alt={report.name} loading="lazy" referrerPolicy="no-referrer" className="size-24 rounded-xl object-cover" />
      ) : (
        <div className="grid size-24 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">No image</div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${report.type === "Lost" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>{report.type}</span>
          <h3 className="text-lg font-extrabold">{report.name}</h3>
          <span className="text-sm text-muted-foreground">· {report.category}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{report.location} · item date {report.item_date}{report.item_time ? ` · ${report.item_time}` : ""} · reported {new Date(report.created_at).toLocaleString()}</p>
        {(report.brand || report.color || report.model) && <p className="mt-1 text-xs font-semibold text-muted-foreground">{[report.brand, report.color, report.model].filter(Boolean).join(" · ")}</p>}
        {report.note && <p className="mt-2 text-sm">{report.note}</p>}
        <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-6 text-muted-foreground">
          <p><span className="font-extrabold text-foreground">Reported by:</span> {report.submitter_name ?? "Unknown"} · UID {report.submitter_uid ?? "—"}</p>
          <p><span className="font-extrabold text-foreground">Account:</span> {report.submitter_role === "admin" ? "Administrator" : report.submitter_role === "student" ? "Student" : "Unknown"}</p>
          <p className="break-all"><span className="font-extrabold text-foreground">Report reference:</span> {report.id}</p>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
          <label className="block text-xs font-extrabold text-muted-foreground">REPORT STATUS
            <select value={report.report_status} disabled={actionBusyId === report.id} onChange={(event) => void updateReportStatus(report, event.target.value as ReportStatus)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-bold text-foreground">
              <option value="new">New</option><option value="under_review">Under review</option><option value="matched">Matched</option><option value="claimed">Claimed</option><option value="returned">Returned</option><option value="closed">Closed</option>
            </select>
          </label>
          <label className="block text-xs font-extrabold text-muted-foreground">MODERATION FLAG
            <select value={selectedFlag} disabled={actionBusyId === report.id} onChange={(event) => setModerationFlagDrafts((current) => ({ ...current, [report.id]: event.target.value as ModerationFlag }))} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-bold text-foreground">
              <option value="none">No flag</option><option value="duplicate">Duplicate</option><option value="suspicious">Suspicious</option><option value="hidden">Hide from students</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <label className="block text-xs font-extrabold text-muted-foreground">PRIVATE MODERATION NOTE
              <textarea rows={2} maxLength={1000} value={moderationDrafts[report.id] ?? ""} onChange={(event) => setModerationDrafts((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Reason for moderation or follow-up note (admin only)" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-normal text-foreground" />
            </label>
            <button type="button" disabled={actionBusyId === report.id || !moderationHasChanges || (selectedFlag !== "none" && (moderationNote.length < 3 || moderationNote.length > 1000))} onClick={() => void updateReportModeration(report, selectedFlag)} className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-foreground hover:bg-secondary disabled:opacity-50">{actionBusyId === report.id ? "Saving…" : "Save moderation"}</button>
            {selectedFlag !== "none" && <p className="mt-2 text-xs font-semibold text-amber-800">A private reason is required. Flagged reports are removed from student search, claims and automatic matching.</p>}
          </div>
          {moderationNotes.filter((note) => note.item_id === report.id).slice(0, 2).map((note) => (
            <p key={note.id} className="sm:col-span-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950"><span className="font-extrabold">Admin note · {new Date(note.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}:</span> {note.note}</p>
          ))}
        </div>
      </div>
    </article>
    );
  };

  const renderReportSection = (title: string, reports: Row[], emptyText: string) => {
    const isLost = title === "Lost reports";
    const currentPage = isLost ? lostReportPage : foundReportPage;
    const pageCount = Math.max(1, Math.ceil(reports.length / 25));
    const pageReports = reports.slice((currentPage - 1) * 25, currentPage * 25);
    const setPage = isLost ? setLostReportPage : setFoundReportPage;
    return (
    <section id={isLost ? "admin-reports" : "admin-found-reports"} className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div>
          <p className="kicker text-emerald-800">Report management</p>
          <h2 className="mt-2 text-2xl font-extrabold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Separate from student login activity.</p>
        </div>
        <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{reports.length} reports</span>
      </div>
      {loading && <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading reports…</p>}
      {!loading && !error && reports.length === 0 && (
        <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">
          {rows.length ? emptyText : title === "Lost reports" ? "No lost items have been reported yet." : "No found items have been reported yet."}
        </p>
      )}
      {!error && reports.length > 0 && (
        <div className="grid gap-4 border-t border-border p-4 sm:p-5">{pageReports.map(renderReportCard)}</div>
      )}
      {!loading && reports.length > 25 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold text-muted-foreground">Page {currentPage} of {pageCount} · {reports.length} matching reports</p>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Previous</button>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((page) => Math.min(pageCount, page + 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </section>
    );
  };

  const renderMatchItem = (label: "Lost item" | "Found item", item: MatchItem) => (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${label === "Lost item" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>
          {label === "Lost item" ? "Lost" : "Found"}
        </span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} loading="lazy" className="size-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] text-muted-foreground">No image</div>
        )}
        <div className="min-w-0">
          <h3 className="font-extrabold text-foreground">{item.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.category} · {item.location}</p>
          <p className="mt-1 text-xs text-muted-foreground">Item date {item.item_date}{item.item_time ? ` · ${item.item_time}` : ""}</p>
          {(item.brand || item.color || item.model) && <p className="mt-1 text-xs font-semibold text-muted-foreground">{[item.brand, item.color, item.model].filter(Boolean).join(" · ")}</p>}
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        <p>Reported by <span className="font-extrabold text-foreground">{item.submitter_name ?? "Unknown"}</span></p>
        <p>UID {item.submitter_uid ?? "—"}</p>
        <p className="break-all">Report ID {item.id}</p>
      </div>
    </div>
  );

  const renderMatchesSection = (
    <section id="admin-matches" className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div className="min-w-0">
          <p className="kicker text-emerald-800">AI matching system</p>
          <h2 className="mt-2 text-2xl font-extrabold">Suggested Lost/Found pairs</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">CampusFind compares active opposite-type reports, ranks likely pairs using item details and available photos, and sends each suggestion here for one administrator return approval.</p>
          {aiStatusMessage && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${aiStatus === "ready" ? "bg-emerald-50 text-emerald-900" : aiStatus === "missing" || aiStatus === "unreachable" ? "bg-amber-50 text-amber-950" : "bg-secondary text-muted-foreground"}`}>{aiStatusMessage}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void testAiEngine()} disabled={aiStatus === "checking"} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
            {aiStatus === "checking" ? "Testing AI…" : "Test AI engine"}
          </button>
          <button type="button" onClick={() => void loadMatches()} disabled={matchesLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
            {matchesLoading ? "Refreshing…" : "Refresh matches"}
          </button>
        </div>
      </div>
      {matchesError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{matchesError}</p>}
      {matchesLoading ? (
        <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading match suggestions…</p>
      ) : matches.length === 0 ? (
        <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground sm:mx-6">There are no pending or approved matches to review. Each newly submitted Lost or Found report is automatically compared with active reports of the opposite type. The board needs at least one active report of each type to produce a pair.</p>
      ) : (
        <div className="grid gap-4 border-t border-border p-4 sm:p-5 lg:grid-cols-2">
          {matches.map((match) => {
            const returnEligible = match.lost.submitter_verified
              && (match.found.submitter_verified || match.found.submitter_role === "admin");
            return (
              <article key={match.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${match.review_status === "confirmed" ? "bg-emerald-50 text-emerald-900" : match.review_status === "rejected" ? "bg-secondary text-muted-foreground" : "bg-amber-50 text-amber-900"}`}>
                    {match.review_status === "confirmed" ? "Approved for return" : match.review_status === "rejected" ? "Dismissed" : "Pending review"}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={match.matched_at}>Detected {new Date(match.matched_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-secondary px-2.5 py-1.5 font-bold">Confidence {match.score ?? "—"}/100</span>
                  <span className="rounded-full bg-secondary px-2.5 py-1.5 font-bold">{match.matching_method === "ai" ? "AI-assisted" : match.matching_method === "text-similarity" ? "Text fallback" : match.matching_method}</span>
                </div>
                {match.match_reason && <p className="mt-3 rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">Why it matched: {match.match_reason}</p>}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {renderMatchItem("Lost item", match.lost)}
                  {renderMatchItem("Found item", match.found)}
                </div>
                <div className="mt-3 rounded-lg border border-border bg-background p-3 text-xs leading-5">
                  <p className="font-extrabold text-foreground">Report-owner verification</p>
                  <p className="mt-1 text-muted-foreground">Lost owner: {match.lost.submitter_verified ? "Verified student" : "Not verified"} · Found owner: {match.found.submitter_verified ? "Verified student" : match.found.submitter_role === "admin" ? "Trusted Admin account" : "Not verified"}</p>
                </div>
                {match.review_status === "pending" && (
                  <div className="mt-4 border-t border-border pt-4">
                    <label className="block text-xs font-extrabold text-muted-foreground">ADMIN REVIEW NOTE
                      <textarea rows={2} maxLength={1000} value={matchDrafts[match.id] ?? match.admin_note ?? ""} onChange={(event) => setMatchDrafts((current) => ({ ...current, [match.id]: event.target.value }))} placeholder="Optional internal note for this return" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-normal text-foreground" />
                    </label>
                    {!returnEligible && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">The Lost report owner must be a verified student. The Found report owner must be verified or use a trusted Admin account. Reporting itself does not require verification.</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={actionBusyId === match.id || !returnEligible} onClick={() => void approveMatchForReturn(match)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">Approve for return</button>
                      <button type="button" disabled={actionBusyId === match.id} onClick={() => void reviewMatch(match, "rejected")} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold hover:bg-secondary disabled:opacity-50">Dismiss suggestion</button>
                      {actionBusyId === match.id && <span className="self-center text-xs text-muted-foreground">Saving decision…</span>}
                    </div>
                  </div>
                )}
                {match.review_status === "confirmed" && (
                  <p className="mt-4 rounded-lg border border-emerald-900/10 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">Approved for return. CampusFind created the claimant’s handover record and sent a one-time code. Verify that code in the Claims section only when the item is physically handed over.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="admin-shell page-enter min-h-screen">
      <header className="admin-topbar sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/admin" className="flex min-w-0 items-center gap-3">
            <span className="admin-brand-icon grid size-11 shrink-0 place-items-center rounded-2xl shadow-sm">
              <ShieldCheck size={22} />
            </span>
            <span className="min-w-0">
              <span className="admin-brand-title block font-display text-lg font-extrabold leading-tight tracking-tight">CampusFind</span>
              <span className="admin-brand-subtitle mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.16em]">Administrator console</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="admin-access-pill hidden rounded-full px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] sm:inline-flex">Restricted access</span>
            <Link to="/browse" className="admin-utility-link inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-extrabold transition sm:text-sm">
              Student site <ArrowUpRight size={15} />
            </Link>
            <button type="button" onClick={() => void signOut()} className="admin-signout inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition sm:px-4 sm:text-sm">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="min-w-0">
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="admin-dashboard-header flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker admin-kicker">Administrator workspace</p>
            <h1 className="admin-dashboard-title mt-2 text-4xl font-extrabold tracking-tight">Control room</h1>
            <p className="admin-dashboard-subtitle mt-2 text-sm leading-6">Lost and found reports, student sign-ins and possible item matches are shown in separate sections.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void load();
              void loadLoginActivity();
              void loadMatches();
              void loadClaims();
              void loadModerationNotes();
              void loadContactMessages();
              void loadStudents();
            }}
            disabled={loading || activityLoading || matchesLoading || claimsLoading || contactLoading || studentsLoading}
            className="admin-refresh-button inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {([["Total", counts.total], ["Lost", counts.lost], ["Found", counts.found]] as const).map(([label, value]) => (
            <div key={label} className="admin-stat-card interactive-card rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="admin-stat-label text-xs font-extrabold uppercase">{label}</p>
              <p className="admin-stat-value mt-2 text-3xl font-extrabold">{value}</p>
            </div>
          ))}
        </div>

        <section id="admin-overview" className="admin-panel mt-6 rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="kicker text-emerald-800">Campus insights</p><h2 className="mt-2 text-2xl font-extrabold">Recovery and activity overview</h2><p className="mt-1 text-sm text-muted-foreground">Calculated from all reports, matches and claims currently stored.</p></div>
            <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{recoveryRate}% reports returned</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Awaiting review", pendingReportsCount],
              ["Pending matches", pendingMatchesCount],
              ["Pending claims", pendingClaimsCount],
              ["Returned reports", returnedReportsCount],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-background p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></div>)}
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-extrabold">Most reported campus areas</h3>
            {topLocations.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No location data yet.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {topLocations.map(([location, count]) => <div key={location} className="rounded-xl bg-background p-3"><div className="flex items-center justify-between gap-3 text-sm"><span className="font-bold">{location}</span><span className="text-xs text-muted-foreground">{count} reports</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${Math.round((count / Math.max(1, topLocations[0]?.[1] ?? 1)) * 100)}%` }} /></div></div>)}
            </div>}
          </div>
        </section>


        <nav aria-label="Administrator sections" className="mt-6 flex flex-wrap gap-2">
          {[["Overview", "#admin-overview"], ["Lost reports", "#admin-reports"], ["Found reports", "#admin-found-reports"], ["Students", "#admin-students"], ["Sign-ins", "#admin-activity"], ["Matches", "#admin-matches"], ["Claims", "#admin-claims"], ["Contact", "#admin-contact"]].map(([label, href]) => <a key={href} href={href} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-foreground transition hover:bg-secondary">{label}</a>)}
        </nav>

        <div className="mt-6 flex flex-wrap gap-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search reports</span>
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} placeholder="Search item, location, student, UID…" className={`${input} w-full pl-9`} />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select value={filter.category} onChange={(event) => setFilter((current) => ({ ...current, category: event.target.value }))} className={input}>
              {categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Report status</span>
            <select value={reportStatusFilter} onChange={(event) => setReportStatusFilter(event.target.value)} className={input}>
              <option value="All">All statuses</option><option value="new">New</option><option value="under_review">Under review</option><option value="matched">Matched</option><option value="claimed">Claimed</option><option value="returned">Returned</option><option value="closed">Closed</option>
            </select>
          </label>
        </div>

        <section id="admin-students" className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div><p className="kicker text-emerald-800">Student identity controls</p><h2 className="mt-2 text-2xl font-extrabold">Student verification</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Only mark a student verified after checking their UID and identity against an authorised Chandigarh University roster or physical student ID. This manual status is not an automatic CU directory check.</p></div>
            <button type="button" onClick={() => void loadStudents()} disabled={studentsLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">{studentsLoading ? "Refreshing…" : "Refresh students"}</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-4 sm:p-5">
            <label className="min-w-56 flex-1"><span className="sr-only">Search students by name or UID</span><input value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Search student name or UID…" className={`${input} w-full`} /></label>
            <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{students.filter((student) => student.verification_status === "verified").length} verified · {students.filter((student) => student.verification_status !== "verified").length} awaiting</span>
          </div>
          {studentsError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{studentsError}</p>}
          {studentsLoading ? <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading student records…</p> : visibleStudents.length === 0 ? <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No student records match this search.</p> : (
            <div className="grid gap-3 border-t border-border p-4 sm:p-5">
              {pageStudents.map((student) => <article key={student.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                <div><p className="font-extrabold">{student.full_name || "Unnamed student"}</p><p className="mt-1 text-xs text-muted-foreground">UID {student.uid}</p><p className="mt-1 text-xs text-muted-foreground">{student.verification_status === "verified" ? `Verified ${student.verified_at ? new Date(student.verified_at).toLocaleDateString("en-IN") : ""}` : "Identity not yet verified"}</p></div>
                {student.verification_status === "verified" ? <button type="button" disabled={verificationBusyId === student.id} onClick={() => void updateStudentVerification(student, false)} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold hover:bg-secondary disabled:opacity-50">{verificationBusyId === student.id ? "Saving…" : "Revoke verification"}</button> : <button type="button" disabled={verificationBusyId === student.id} onClick={() => void updateStudentVerification(student, true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">{verificationBusyId === student.id ? "Saving…" : "Mark verified"}</button>}
              </article>)}
              {visibleStudents.length > 25 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="text-xs text-muted-foreground">Page {studentPage} of {studentPageCount} · {visibleStudents.length} students</span><div className="flex gap-2"><button type="button" disabled={studentPage <= 1} onClick={() => setStudentPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Previous</button><button type="button" disabled={studentPage >= studentPageCount} onClick={() => setStudentPage((page) => Math.min(studentPageCount, page + 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Next</button></div></div>}
            </div>
          )}
        </section>

        {reportActionError && <p role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold text-destructive">{reportActionError}</p>}
        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold text-destructive">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-2 underline underline-offset-4">Try again</button>
          </div>
        )}

        {renderReportSection("Lost reports", visibleLost, "No lost-item reports match these filters.")}
        {renderReportSection("Found reports", visibleFound, "No found-item reports match these filters.")}


        <section id="admin-activity" className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Account activity</p>
              <h2 className="mt-2 text-2xl font-extrabold">Recent sign-ins</h2>
              <p className="mt-1 text-sm text-muted-foreground">All recorded successful student sign-ins. Administrator sign-ins are kept separate.</p>
            </div>
            <button type="button" onClick={() => void loadLoginActivity()} disabled={activityLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
              {activityLoading ? "Refreshing…" : "Refresh activity"}
            </button>
          </div>
          {activityError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{activityError}</p>}
          {activityLoading ? (
            <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading sign-in activity…</p>
          ) : loginEvents.length === 0 ? (
            <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No successful sign-ins have been recorded yet. New logins will appear here.</p>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-extrabold sm:px-6">Person</th>
                    <th className="px-5 py-3 font-extrabold">Method</th>
                    <th className="px-5 py-3 font-extrabold">Signed in</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLoginEvents.map((event) => (
                    <tr key={event.id} className="border-t border-border align-top">
                      <td className="px-5 py-4 sm:px-6">
                        <p className="font-extrabold">{event.full_name ?? "Unknown account"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">UID {event.uid ?? "—"}</p>
                      </td>
                      <td className="px-5 py-4">{event.login_method === "otp" ? "SMS OTP" : event.login_method === "signup" ? "Account created" : "Password"}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{new Date(event.logged_in_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!activityLoading && loginEvents.length > 25 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><span className="text-xs text-muted-foreground">Page {activityPage} of {activityPageCount} · {loginEvents.length} sign-ins</span><div className="flex gap-2"><button type="button" disabled={activityPage <= 1} onClick={() => setActivityPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Previous</button><button type="button" disabled={activityPage >= activityPageCount} onClick={() => setActivityPage((page) => Math.min(activityPageCount, page + 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Next</button></div></div>}
        </section>

        {renderMatchesSection}

        <section id="admin-claims" className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div><p className="kicker text-emerald-800">Physical handover</p><h2 className="mt-2 text-2xl font-extrabold">Claims and return codes</h2><p className="mt-1 text-sm text-muted-foreground">AI-approved matches arrive here already approved, with a one-time code sent to the claimant. Verify the code only during the physical handover. Manually submitted claims still require review.</p></div>
            <button type="button" onClick={() => void loadClaims()} disabled={claimsLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">{claimsLoading ? "Refreshing…" : "Refresh claims"}</button>
          </div>
          {claimsError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{claimsError}</p>}
          {claimsLoading ? <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading claims…</p> : claims.length === 0 ? <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No item claims have been submitted.</p> : (
            <div className="grid gap-3 border-t border-border p-4 sm:p-5">
              {claims.map((claim) => (
                <article key={claim.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h3 className="font-extrabold text-foreground">{claim.item_name}</h3><p className="mt-1 text-sm text-muted-foreground">{claim.item_location}</p><p className="mt-2 text-xs text-muted-foreground">Claimed by {claim.claimant_name ?? "Unknown"} · UID {claim.claimant_uid ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">Found report submitted by {claim.item_owner_name ?? "Unknown"} · UID {claim.item_owner_uid ?? "—"}</p></div>
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold">{claim.status.toUpperCase()}</span>
                  </div>
                  {!claim.source_match_id && <div className="mt-4 rounded-xl bg-secondary/60 p-4"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Private ownership proof</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{claim.proof}</p></div>}
                  {claim.admin_note && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">Previous review note: {claim.admin_note}</p>}
                  {claim.status !== "rejected" && claim.status !== "completed" && (
                    <div className="mt-4 border-t border-border pt-4">
                      <label className="block text-xs font-extrabold text-muted-foreground">DECISION NOTE
                        <textarea rows={2} maxLength={1000} value={claimDrafts[claim.id] ?? ""} onChange={(event) => setClaimDrafts((current) => ({ ...current, [claim.id]: event.target.value }))} placeholder="Explain approval or rejection, or write a handover note" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-normal text-foreground" />
                      </label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {claim.status === "pending" && <>
                          <button type="button" disabled={actionBusyId === claim.id} onClick={() => void reviewClaim(claim, "approved")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50">Approve claim</button>
                          <button type="button" disabled={actionBusyId === claim.id} onClick={() => void reviewClaim(claim, "rejected")} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold hover:bg-secondary disabled:opacity-50">Reject claim</button>
                        </>}
                        {claim.status === "approved" && <div className="w-full max-w-md"><label className="block text-xs font-extrabold text-muted-foreground">CLAIMANT HANDOVER CODE<input inputMode="text" autoComplete="off" maxLength={12} value={claimHandoverCodeDrafts[claim.id] ?? ""} onChange={(event) => setClaimHandoverCodeDrafts((current) => ({ ...current, [claim.id]: event.target.value.toUpperCase().replace(/[^A-F0-9]/g, "") }))} placeholder="12-character code shown by claimant" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-sm tracking-widest" /></label><p className="mt-1 text-xs leading-5 text-muted-foreground">Enter the code only when the claimant shows it to you during the physical handover.</p><button type="button" disabled={actionBusyId === claim.id || !/^[A-F0-9]{12}$/.test(claimHandoverCodeDrafts[claim.id] ?? "")} onClick={() => void reviewClaim(claim, "completed")} className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-white hover:bg-primary/90 disabled:opacity-50">Verify handover and mark returned</button></div>}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        

        <section id="admin-contact" className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">In-site support</p>
              <h2 className="mt-2 text-2xl font-extrabold">Student support conversations</h2>
              <p className="mt-1 text-sm text-muted-foreground">Reply to issues directly in CampusFind. Students see your reply in their own Help & Support inbox.</p>
              <p className="mt-1 text-sm text-muted-foreground">No email address or external email is used.</p>
            </div>
            <button type="button" onClick={() => void loadContactMessages()} disabled={contactLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
              {contactLoading ? "Refreshing…" : "Refresh inbox"}
            </button>
          </div>
          {contactError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{contactError}</p>}
          <div className="border-t border-border p-4 sm:p-5"><label className="block max-w-xl text-xs font-extrabold text-muted-foreground">SEARCH CONVERSATIONS<input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search student, UID, subject or message…" className={input + " mt-2 w-full"} /></label></div>
          {contactLoading ? (
            <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading support conversations…</p>
          ) : filteredContactMessages.length === 0 ? (
            <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">{contactMessages.length === 0 ? "No support conversations have been received yet." : "No conversations match this search."}</p>
          ) : (
            <div className="grid gap-3 border-t border-border p-4 sm:p-5">
              {pageContactMessages.map((ticket) => (
                <article key={ticket.id} className="overflow-hidden rounded-xl border border-border bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                    <div>
                      <h3 className="font-extrabold text-foreground">{ticket.subject}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">From {ticket.user_name ?? "CampusFind user"} · UID {ticket.user_uid ?? "—"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Received {new Date(ticket.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · Updated {new Date(ticket.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={ticket.status === "open" ? "rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-800" : "rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold text-secondary-foreground"}>{ticket.status === "open" ? "Open" : "Resolved"}</span>
                      <button type="button" disabled={contactReplyBusyId === ticket.id} onClick={() => void setContactTicketStatus(ticket, ticket.status === "open" ? "resolved" : "open")} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold text-foreground hover:bg-secondary disabled:opacity-50">{ticket.status === "open" ? "Mark resolved" : "Reopen"}</button>
                    </div>
                  </div>
                  <div className="grid gap-3 bg-background p-4 sm:p-5">
                    {ticket.messages.map((entry) => (
                      <div key={entry.id} className={entry.sender_role === "admin" ? "ml-0 mr-6 rounded-xl border border-emerald-900/10 bg-emerald-50 p-4 sm:mr-16" : "ml-6 rounded-xl border border-border bg-white p-4 sm:ml-16"}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-extrabold text-foreground">{entry.sender_role === "admin" ? "CampusFind Administrator" : entry.sender_name ?? "Student"}{entry.sender_role !== "admin" && entry.sender_uid ? " · " + entry.sender_uid : ""}</p>
                          <time className="text-[11px] text-muted-foreground" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{entry.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border p-4 sm:p-5">
                    <label className="block text-xs font-extrabold text-muted-foreground">REPLY TO STUDENT
                      <textarea rows={3} maxLength={5000} value={contactReplyDrafts[ticket.id] ?? ""} onChange={(event) => setContactReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Write your response…" className={input + " mt-2 w-full resize-y"} />
                    </label>
                    <button type="button" disabled={contactReplyBusyId === ticket.id || !(contactReplyDrafts[ticket.id] ?? "").trim()} onClick={() => void sendContactReply(ticket)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{contactReplyBusyId === ticket.id ? "Sending…" : "Send reply"} <Send size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!contactLoading && filteredContactMessages.length > 25 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><span className="text-xs text-muted-foreground">Page {contactPage} of {contactPageCount} · {filteredContactMessages.length} conversations</span><div className="flex gap-2"><button type="button" disabled={contactPage <= 1} onClick={() => setContactPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Previous</button><button type="button" disabled={contactPage >= contactPageCount} onClick={() => setContactPage((page) => Math.min(contactPageCount, page + 1))} className="rounded-lg border border-border px-3 py-2 text-xs font-extrabold disabled:opacity-40">Next</button></div></div>}
        </section>


      </section>
      </main>
    </div>
  );
}
