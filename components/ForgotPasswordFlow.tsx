"use client";

import { useEffect, useState, type FormEvent } from "react";

type Step = "email" | "code" | "reset";

interface ForgotPasswordFlowProps {
  initialEmail: string;
  onBack: () => void;
  onDone: (email: string) => void;
  onClose: () => void;
}

const RESEND_SECONDS = 60;

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";
const primaryBtn =
  "w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60";
const linkBtn = "font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline";

async function post(
  url: string,
  body: Record<string, string>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "Something went wrong",
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

const TITLES: Record<Step, { title: string; subtitle: string }> = {
  email: {
    title: "Forgot your password?",
    subtitle: "Enter your account email and we will send you a 6-digit code.",
  },
  code: {
    title: "Check your email",
    subtitle: "Enter the 6-digit code we sent you.",
  },
  reset: {
    title: "Set a new password",
    subtitle: "Choose a new password for your account.",
  },
};

export function ForgotPasswordFlow({
  initialEmail,
  onBack,
  onDone,
  onClose,
}: ForgotPasswordFlowProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail.trim());
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);

    const result = await post("/api/auth/forgot-password", { email });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setOtp("");
    setResendIn(RESEND_SECONDS);
    setInfo(`A code is sent for ${email}, if registered`);
    setStep("code");
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await post("/api/auth/forgot-password/verify", { email, otp });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const token = result.data.resetToken;
    if (typeof token !== "string") {
      setError("Something went wrong. Please try again.");
      return;
    }

    setResetToken(token);
    setInfo(null);
    setStep("reset");
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    const result = await post("/api/auth/forgot-password/reset", {
      resetToken,
      password,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onDone(email);
  }

  const { title, subtitle } = TITLES[step];

  return (
    <>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2
            id="auth-modal-title"
            className="price-heading text-xl font-extrabold text-slate-900"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          ×
        </button>
      </div>

      {step === "email" && (
        <form onSubmit={requestCode} className="space-y-4" noValidate>
          <div>
            <label htmlFor="forgot-email" className={labelCls}>
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={inputCls}
              autoFocus
            />
          </div>

          {error && <ErrorNote message={error} />}

          <button type="submit" disabled={submitting} className={primaryBtn}>
            {submitting ? "Sending…" : "Send code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-4" noValidate>
          {info && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              {info}
            </p>
          )}

          <div>
            <label htmlFor="forgot-otp" className={labelCls}>
              6-digit code
            </label>
            <input
              id="forgot-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              disabled={submitting}
              className={`${inputCls} text-center text-lg tracking-[0.5em]`}
              autoFocus
            />
          </div>

          {error && <ErrorNote message={error} />}

          <button
            type="submit"
            disabled={submitting || otp.length !== 6}
            className={primaryBtn}
          >
            {submitting ? "Checking…" : "Verify code"}
          </button>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setStep("email");
              }}
              className={linkBtn}
            >
              Change email
            </button>
            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={submitting || resendIn > 0}
              className={linkBtn}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={resetPassword} className="space-y-4" noValidate>
     
<div>
  <label htmlFor="forgot-password" className={labelCls}>
    New password
  </label>

  <div className="relative">
    <input
      id="forgot-password"
      type={showPassword ? "text" : "password"}
      autoComplete="new-password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      disabled={submitting}
      className={`${inputCls} pr-10`}
      autoFocus
    />

    <button
      type="button"
      onClick={() => setShowPassword((prev) => !prev)}
      aria-label={showPassword ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
    >
      {showPassword ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A11 11 0 0 1 12 5c5 0 9 4 10 7-.5 1.5-1.5 2.8-2.7 3.8" />
          <path d="M6.2 6.2C3.9 7.5 2.5 9.5 2 12c1 3 5 7 10 7 1 0 2-.2 2.9-.5" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  </div>

  <p className="mt-1 text-xs text-slate-500">
    At least 8 characters
  </p>
</div>


         
<div>
  <label htmlFor="forgot-confirm" className={labelCls}>
    Confirm new password
  </label>

  <div className="relative">
    <input
      id="forgot-confirm"
      type={showConfirm ? "text" : "password"}
      autoComplete="new-password"
      value={confirm}
      onChange={(e) => setConfirm(e.target.value)}
      disabled={submitting}
      className={`${inputCls} pr-10`}
    />

    <button
      type="button"
      onClick={() => setShowConfirm((prev) => !prev)}
      aria-label={showConfirm ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
    >
      {showConfirm ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A11 11 0 0 1 12 5c5 0 9 4 10 7-.5 1.5-1.5 2.8-2.7 3.8" />
          <path d="M6.2 6.2C3.9 7.5 2.5 9.5 2 12c1 3 5 7 10 7 1 0 2-.2 2.9-.5" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  </div>
</div>


          {error && <ErrorNote message={error} />}

          <button type="submit" disabled={submitting} className={primaryBtn}>
            {submitting ? "Saving…" : "Reset password"}
          </button>
        </form>
      )}

      <p className="mt-4 text-center text-sm text-slate-600">
        Remembered it?{" "}
        <button type="button" onClick={onBack} className={linkBtn}>
          Back to log in
        </button>
      </p>
    </>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}
