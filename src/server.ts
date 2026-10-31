import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const CANONICAL_ORIGIN = "https://campusfind-uir0.onrender.com";
const DUPLICATE_HOSTS = new Set(["campusfind-fs6c.onrender.com"]);
const PRIVATE_PATHS = new Set([
  "/auth", "/reset-password", "/admin-login", "/admin", "/browse", "/report",
]);

const PAGE_META: Record<string, { title: string; description: string; indexable: boolean }> = {
  "/": {
    title: "CampusFind — Smart Campus Lost & Found",
    description: "Report lost belongings, browse found items, and reconnect campus belongings more safely at Chandigarh University.",
    indexable: true,
  },
  "/how-it-works": {
    title: "How CampusFind Works — Lost & Found at CU",
    description: "Learn how to report an item, search campus lost-and-found reports, and verify ownership before arranging a return.",
    indexable: true,
  },
  "/contact": {
    title: "Contact CampusFind",
    description: "Send a question or report a problem to the CampusFind administrators.",
    indexable: true,
  },
  "/privacy": {
    title: "Privacy Policy — CampusFind",
    description: "Learn how CampusFind handles account details, lost-and-found reports, private campus pins, and contact messages.",
    indexable: true,
  },
  "/auth": {
    title: "Student Sign In — CampusFind",
    description: "Sign in to CampusFind using your registered mobile number and password or one-time code.",
    indexable: false,
  },
  "/reset-password": {
    title: "Reset Password — CampusFind",
    description: "Recover access to your CampusFind account.",
    indexable: false,
  },
  "/admin-login": {
    title: "Administrator Sign In — CampusFind",
    description: "Restricted sign-in for authorised CampusFind administrators.",
    indexable: false,
  },
  "/admin": {
    title: "Administrator Dashboard — CampusFind",
    description: "Restricted moderation dashboard for CampusFind administrators.",
    indexable: false,
  },
  "/browse": {
    title: "Browse Campus Reports — CampusFind",
    description: "Browse lost-and-found reports shared with signed-in CampusFind users.",
    indexable: false,
  },
  "/report": {
    title: "Report a Lost or Found Item — CampusFind",
    description: "Create a campus lost-and-found report with a written building or landmark. Exact map pins are managed privately by administrators.",
    indexable: false,
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function upsertMeta(html: string, attribute: "name" | "property", key: string, content: string): string {
  const tag = '<meta ' + attribute + '="' + escapeHtml(key) + '" content="' + escapeHtml(content) + '">';
  const pattern = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "=[\"']" + key + "[\"'])[^>]*\\/?>", "gi");
  let inserted = false;
  const replaced = html.replace(pattern, () => {
    if (inserted) return "";
    inserted = true;
    return tag;
  });
  return inserted ? replaced : replaced.replace(/<\/head>/i, tag + "\n</head>");
}

function upsertCanonical(html: string, href: string | null): string {
  const pattern = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\/?>/gi;
  let inserted = false;
  const replaced = html.replace(pattern, () => {
    if (!href || inserted) return "";
    inserted = true;
    return '<link rel="canonical" href="' + escapeHtml(href) + '">';
  });
  if (!href || inserted) return replaced;
  return replaced.replace(/<\/head>/i, '<link rel="canonical" href="' + escapeHtml(href) + '">\n</head>');
}

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error("A server-rendering request failed."));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function injectSeo(html: string, url: URL, status: number): string {
  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  const known = PAGE_META[pathname];
  const page = status === 404
    ? { title: "Page Not Found — CampusFind", description: "This CampusFind page could not be found. Return to the homepage to continue.", indexable: false }
    : known ?? { title: "CampusFind", description: "CampusFind campus lost and found.", indexable: false };
  const canonical = page.indexable ? CANONICAL_ORIGIN + (pathname === "/" ? "/" : pathname) : null;
  const image = CANONICAL_ORIGIN + "/og-campusfind.svg";

  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(page.title) + "</title>");
  html = upsertMeta(html, "name", "description", page.description);
  html = upsertMeta(html, "property", "og:title", page.title);
  html = upsertMeta(html, "property", "og:description", page.description);
  html = upsertMeta(html, "property", "og:type", "website");
  html = upsertMeta(html, "property", "og:image", image);
  html = upsertMeta(html, "property", "og:image:alt", "CampusFind — Chandigarh University lost and found");
  html = upsertMeta(html, "property", "og:url", canonical ?? CANONICAL_ORIGIN + pathname);
  html = upsertMeta(html, "name", "twitter:card", "summary_large_image");
  html = upsertMeta(html, "name", "twitter:title", page.title);
  html = upsertMeta(html, "name", "twitter:description", page.description);
  html = upsertMeta(html, "name", "twitter:image", image);
  html = upsertMeta(html, "name", "robots", page.indexable ? "index, follow" : "noindex, nofollow");
  html = upsertCanonical(html, canonical);

  const hasOrganizationSchema = html.includes('id="campusfind-organization-schema"');
  if (page.indexable && !hasOrganizationSchema) {
    const organization = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "CampusFind",
      url: CANONICAL_ORIGIN,
      logo: CANONICAL_ORIGIN + "/campusfind-favicon.svg",
      description: "Campus lost-and-found service for Chandigarh University.",
    };
    const breadcrumbs = pathname === "/"
      ? [{ name: "Home", url: CANONICAL_ORIGIN }]
      : [
          { name: "Home", url: CANONICAL_ORIGIN },
          { name: page.title.split(" — ")[0], url: canonical },
        ];
    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    };
    const structuredData =
      '<script id="campusfind-organization-schema" type="application/ld+json">' + escapeJsonForHtml(organization) + "</script>" +
      '<script id="campusfind-breadcrumb-schema" type="application/ld+json">' + escapeJsonForHtml(breadcrumbSchema) + "</script>";
    html = html.replace(/<\/head>/i, structuredData + "\n</head>");
  }

  const verification = process.env["VITE_GOOGLE_SITE_VERIFICATION"]?.trim();
  if (verification && /^[A-Za-z0-9_-]{10,200}$/.test(verification)) {
    html = upsertMeta(html, "name", "google-site-verification", verification);
  }

  const measurementId = process.env["VITE_GA_MEASUREMENT_ID"]?.trim();
  if (measurementId && /^G-[A-Z0-9]{5,20}$/.test(measurementId) && !html.includes("googletagmanager.com/gtag/js")) {
    const analytics = '<script async src="https://www.googletagmanager.com/gtag/js?id=' + measurementId + '"></script>' +
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','" + measurementId + "');</script>";
    html = html.replace(/<\/head>/i, analytics + "\n</head>");
  }
  return html;
}

function tagWithNonce(html: string, tagName: "script" | "style", nonce: string): string {
  const pattern = new RegExp("<" + tagName + "\\b([^>]*)>", "gi");
  return html.replace(pattern, (_whole, rawAttributes: string) => {
    const attributes = rawAttributes.replace(/\snonce\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
    return "<" + tagName + ' nonce="' + nonce + '"' + attributes + ">";
  });
}

function applySecurityHeaders(response: Response, nonce: string, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic' https://unpkg.com https://www.googletagmanager.com",
      "style-src 'self' 'nonce-" + nonce + "' https://unpkg.com https://fonts.googleapis.com",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org https://www.vidyavision.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://*.tile.openstreetmap.org",
      "frame-src https://www.openstreetmap.org",
      "form-action 'self' https://*.supabase.co",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "geolocation=(self), camera=(self), microphone=(), payment=()");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.delete("X-Powered-By");

  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  if (PRIVATE_PATHS.has(pathname) || pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function hardenResponse(request: Request, response: Response): Promise<Response> {
  const url = new URL(request.url);
  const nonce = newNonce();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return applySecurityHeaders(response, nonce, url);
  }

  let html = await response.text();
  html = injectSeo(html, url, response.status);
  html = tagWithNonce(html, "script", nonce);
  html = tagWithNonce(html, "style", nonce);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("content-type", contentType || "text/html; charset=utf-8");
  const result = new Response(html, { status: response.status, statusText: response.statusText, headers });
  return applySecurityHeaders(result, nonce, url);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const requestUrl = new URL(request.url);
    if (DUPLICATE_HOSTS.has(requestUrl.hostname.toLowerCase())) {
      const destination = new URL(requestUrl.pathname + requestUrl.search, CANONICAL_ORIGIN);
      return hardenResponse(request, Response.redirect(destination.toString(), 301));
    }
    if (
      requestUrl.hostname.toLowerCase() === new URL(CANONICAL_ORIGIN).hostname &&
      requestUrl.pathname.length > 1 &&
      requestUrl.pathname.endsWith("/")
    ) {
      const normalizedPath = requestUrl.pathname.replace(/\/+$/, "") || "/";
      const destination = new URL(normalizedPath + requestUrl.search, CANONICAL_ORIGIN);
      return hardenResponse(request, Response.redirect(destination.toString(), 301));
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await hardenResponse(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return hardenResponse(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
