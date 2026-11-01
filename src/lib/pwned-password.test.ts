import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPasswordAgainstBreaches } from "@/lib/pwned-password";

const password = "password";
const prefix = "5BAA6";
const suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function fetchWith(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("checkPasswordAgainstBreaches", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the local SHA-1 digest and sends only the five-character prefix with padding", async () => {
    const fetchImpl = fetchWith(`${suffix}:0\r\n`);
    const result = await checkPasswordAgainstBreaches(password, { fetchImpl });

    expect(result).toEqual({ status: "SAFE" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(url).not.toContain(suffix);
    expect(init.headers).toEqual({ Accept: "text/plain", "Add-Padding": "true" });
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
  });

  it("marks a matching suffix with a positive count as compromised, case-insensitively", async () => {
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith(`${suffix.toLowerCase()}:2\r\n`) }))
      .toEqual({ status: "COMPROMISED" });
  });

  it("allows a matching hash with a zero count from the padded response", async () => {
    const padded = `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:4\r\n${suffix}:0\r\n`;
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith(padded) })).toEqual({ status: "SAFE" });
  });

  it("allows a password absent from the returned range", async () => {
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith(`${"A".repeat(35)}:1\r\n`) }))
      .toEqual({ status: "SAFE" });
  });

  it("rejects empty input without making a request", async () => {
    const fetchImpl = fetchWith("");
    expect(await checkPasswordAgainstBreaches("", { fetchImpl })).toEqual({ status: "INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not write passwords, hashes, or HIBP response data to logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith(`${suffix}:7\r\n`) });
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("treats malformed or empty API responses as invalid", async () => {
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith("not-a-hash:1\r\n") }))
      .toEqual({ status: "INVALID" });
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith("\r\n") }))
      .toEqual({ status: "INVALID" });
  });

  it("fails closed on network errors and unexpected HTTP statuses, including rate limiting", async () => {
    const networkFailure = vi.fn(async () => { throw new TypeError("network failure"); }) as unknown as typeof fetch;
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: networkFailure })).toEqual({ status: "UNAVAILABLE" });
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith("", 429) })).toEqual({ status: "UNAVAILABLE" });
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: fetchWith("", 503) })).toEqual({ status: "UNAVAILABLE" });
  });

  it("times out and allows a later user-initiated retry", async () => {
    vi.useFakeTimers();
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    const timeoutFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      markFetchStarted();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const pending = checkPasswordAgainstBreaches(password, { fetchImpl: timeoutFetch, timeoutMs: 25 });
    await fetchStarted;
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ status: "UNAVAILABLE" });

    const retryFetch = fetchWith(`${"A".repeat(35)}:1\r\n`);
    expect(await checkPasswordAgainstBreaches(password, { fetchImpl: retryFetch })).toEqual({ status: "SAFE" });
    expect(retryFetch).toHaveBeenCalledTimes(1);
  });
});
