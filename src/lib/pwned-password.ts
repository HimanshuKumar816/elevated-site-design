const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const DEFAULT_TIMEOUT_MS = 5_000;

export type PwnedPasswordResult =
  | { status: "SAFE" }
  | { status: "COMPROMISED" }
  | { status: "UNAVAILABLE" }
  | { status: "INVALID" };

type FetchLike = typeof fetch;

/**
 * Checks a password with HIBP's free k-anonymity range API. Only the first five
 * characters of the locally computed SHA-1 digest leave this browser context.
 * SHA-1 is used solely for this lookup protocol, never for password storage.
 */
export async function checkPasswordAgainstBreaches(
  password: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<PwnedPasswordResult> {
  if (typeof password !== "string" || password.length === 0) return { status: "INVALID" };
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return { status: "UNAVAILABLE" };

  let fullHash: string;
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    fullHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  } catch {
    return { status: "UNAVAILABLE" };
  }

  let prefix = fullHash.slice(0, 5);
  let suffix = fullHash.slice(5);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await (options.fetchImpl ?? fetch)(`${HIBP_RANGE_URL}${prefix}`, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "Add-Padding": "true",
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { status: "UNAVAILABLE" };

    const body = await response.text();
    const entries = body.split(/\r?\n/).filter((line) => line.length > 0);
    if (entries.length === 0) return { status: "INVALID" };

    let compromised = false;
    for (const entry of entries) {
      const match = /^([A-Fa-f0-9]{35}):([0-9]+)$/.exec(entry);
      const count = Number(match?.[2]);
      if (!match || !Number.isSafeInteger(count)) return { status: "INVALID" };
      if (match[1]?.toUpperCase() === suffix && count > 0) compromised = true;
    }
    return compromised ? { status: "COMPROMISED" } : { status: "SAFE" };
  } catch {
    return { status: "UNAVAILABLE" };
  } finally {
    globalThis.clearTimeout(timeout);
    // Drop references to local hash material as soon as the request is finished.
    fullHash = "";
    prefix = "";
    suffix = "";
  }
}

export function passwordCheckMessage(result: PwnedPasswordResult): string {
  switch (result.status) {
    case "COMPROMISED":
      return "This password has appeared in known data breaches. Please choose a different password.";
    case "UNAVAILABLE":
      return "We couldn't verify your password security right now. Please try again shortly.";
    case "INVALID":
      return "We couldn't verify this password. Please check it and try again.";
    case "SAFE":
      return "";
  }
}
