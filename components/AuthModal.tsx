"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ForgotPasswordFlow } from "@/components/ForgotPasswordFlow";

export type AuthMode = "login" | "signup";

interface AuthModalProps {
  mode: AuthMode | null;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60";

export function AuthModal({ mode, onModeChange, onClose }: AuthModalProps) {
  const { login, signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<"auth" | "forgot">("auth");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setView("auth");
  }, [mode]);

  useEffect(() => {
    if (!mode) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose]);

  if (!mode) return null;

  const isSignup = mode === "signup";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = isSignup
      ? await signup(name, email, password)
      : await login(email, password);

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setName("");
    setEmail("");
    setPassword("");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-print="hide"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="w-full max-w-sm rounded-2xl border border-white/60 bg-white p-6 shadow-2xl"
      >
        {view === "forgot" && !isSignup ? (
          <ForgotPasswordFlow
            initialEmail={email}
            onBack={() => setView("auth")}
            onClose={onClose}
            onDone={(doneEmail) => {
              setEmail(doneEmail);
              setPassword("");
              setError(null);
              setNotice("Password updated. Log in with your new password.");
              setView("auth");
            }}
          />
        ) : (
        <>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2
              id="auth-modal-title"
              className="price-heading text-xl font-extrabold text-slate-900"
            >
              {isSignup ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {isSignup
                ? "Sign up to save trips and come back to them anytime."
                : "Log in to see your saved trips."}
            </p>
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

        {notice && !isSignup && (
          <p
            role="status"
            className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {isSignup && (
            <div>
              <label
                htmlFor="auth-name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Name
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                className={inputCls}
                autoFocus
              />
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={inputCls}
              autoFocus={!isSignup}
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <div className="relative">
  <input
    id="auth-password"
    type={showPassword ? "text" : "password"}
    autoComplete={isSignup ? "new-password" : "current-password"}
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    disabled={submitting}
    className={`${inputCls} pr-10`}
  />

  <button
    type="button"
    onClick={() => setShowPassword((prev) => !prev)}
    aria-label={showPassword ? "Hide password" : "Show password"}
    aria-pressed={showPassword}
    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
  >
    {showPassword ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A11 11 0 0 1 12 5c5 0 9 4 10 7-0.5 1.5-1.5 2.8-2.7 3.8" />
        <path d="M6.2 6.2C3.9 7.5 2.5 9.5 2 12c1 3 5 7 10 7 1 0 2-.2 2.9-.5" />
      </svg>
    ) : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </button>
</div>
            {isSignup && (
              <p className="mt-1 text-xs text-slate-500">At least 8 characters</p>
            )}
            {!isSignup && (
              <div className="mt-1 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setView("forgot");
                  }}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? "Please wait…"
              : isSignup
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          {isSignup ? "Already have an account?" : "New to PriceMyTrip?"}{" "}
          <button
            type="button"
            onClick={() => onModeChange(isSignup ? "login" : "signup")}
            className="font-semibold text-blue-700 hover:underline"
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
