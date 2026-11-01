import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route as AuthRoute } from "@/routes/auth";
import { Route as ResetPasswordRoute } from "@/routes/reset-password";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signInWithUid: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
  auth: {
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({ redirect: "/browse" }) }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/components/site", () => ({ Page: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: mocks.auth } }));
vi.mock("@/lib/auth.functions", () => ({ signInWithUid: mocks.signInWithUid }));
vi.mock("@/lib/login-events", () => ({ recordSuccessfulLogin: mocks.recordSuccessfulLogin }));

const compromisedSuffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function HIBPResponse(body: string, status = 200) {
  return new Response(body, { status });
}

function renderAuth() {
  return render(createElement(AuthRoute.options.component!));
}

function renderReset() {
  return render(createElement(ResetPasswordRoute.options.component!));
}

async function fillSignup(password: string) {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Student name"), { target: { value: "Asha Rao" } });
  fireEvent.change(screen.getByLabelText("Student UID"), { target: { value: "26BCS11930" } });
  fireEvent.change(screen.getByLabelText("Student phone number"), { target: { value: "9876543210" } });
  fireEvent.change(screen.getAllByLabelText("Password")[0]!, { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
}

describe("password security integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.signInWithOtp.mockResolvedValue({ error: null });
    mocks.auth.verifyOtp.mockResolvedValue({
      data: { user: { user_metadata: { uid: "26BCS11930" } }, session: { access_token: "test", refresh_token: "test" } },
      error: null,
    });
    mocks.auth.updateUser.mockResolvedValue({ error: null });
    mocks.auth.getSession.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
    mocks.recordSuccessfulLogin.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("allows signup with a safe password and reuses its successful check after OTP", async () => {
    vi.mocked(fetch).mockResolvedValue(HIBPResponse(`${"A".repeat(35)}:1\r\n`));
    renderAuth();
    await fillSignup("safe-test-password");

    await waitFor(() => expect(mocks.auth.signInWithOtp).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify & create account" }));
    await waitFor(() => expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "safe-test-password" }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks signup when the password is compromised or HIBP is unavailable", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(HIBPResponse(`${compromisedSuffix}:1\r\n`))
      .mockResolvedValueOnce(HIBPResponse("", 503));
    const { unmount } = renderAuth();
    await fillSignup("password");
    expect(await screen.findByRole("alert")).toHaveTextContent("appeared in known data breaches");
    expect(mocks.auth.signInWithOtp).not.toHaveBeenCalled();
    unmount();

    renderAuth();
    await fillSignup("safe-test-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("try again shortly");
    expect(mocks.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("blocks a reset-link password update for a compromised password", async () => {
    vi.mocked(fetch).mockResolvedValue(HIBPResponse(`${compromisedSuffix}:4\r\n`));
    renderReset();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("appeared in known data breaches");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("allows a reset-link update with a safe password", async () => {
    vi.mocked(fetch).mockResolvedValue(HIBPResponse(`${"A".repeat(35)}:1\r\n`));
    renderReset();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "safe-reset-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "safe-reset-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "safe-reset-password" }));
    expect(await screen.findByText(/password has been updated/i)).toBeInTheDocument();
  });

  it("checks SMS recovery passwords and leaves Auth untouched when HIBP is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValue(HIBPResponse("", 503));
    renderAuth();
    fireEvent.click(screen.getByRole("button", { name: "Forgot / set password" }));
    fireEvent.change(screen.getByLabelText("Student phone number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await waitFor(() => expect(mocks.auth.signInWithOtp).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await screen.findByText("Choose a new password");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-recovery-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "safe-recovery-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password & continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("try again shortly");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("allows an SMS recovery password after a safe HIBP result", async () => {
    vi.mocked(fetch).mockResolvedValue(HIBPResponse(`${"A".repeat(35)}:1\r\n`));
    renderAuth();
    fireEvent.click(screen.getByRole("button", { name: "Forgot / set password" }));
    fireEvent.change(screen.getByLabelText("Student phone number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await waitFor(() => expect(mocks.auth.signInWithOtp).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await screen.findByText("Choose a new password");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-recovery-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "safe-recovery-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password & continue" }));

    await waitFor(() => expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "safe-recovery-password" }));
  });

  it("keeps login independent of HIBP availability", async () => {
    mocks.signInWithUid.mockResolvedValue({ ok: false, error: "Incorrect UID or password." });
    renderAuth();
    fireEvent.change(screen.getByLabelText("Student UID"), { target: { value: "26BCS11930" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "existing-password" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" }).at(-1)!);

    await waitFor(() => expect(mocks.signInWithUid).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
  });
});
