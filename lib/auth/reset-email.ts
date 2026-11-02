import { isMailConfigured, sendMail } from "@/lib/email/gmail";
import { OTP_TTL_MS } from "@/lib/auth/password-reset";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildResetEmail(name: string, otp: string) {
  const minutes = Math.round(OTP_TTL_MS / 60000);

  const text = [
    `Hello ${name},`,
    "",
    `Your PriceMyTrip password reset code is: ${otp}`,
    "",
    `This code expires in ${minutes} minutes. Do not share it with anyone.`,
    "If you did not ask to reset your password, you can ignore this email.",
    "",
    "PriceMyTrip",
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
  <h2 style="margin:0 0 12px">Reset your password</h2>
  <p>Hello ${escapeHtml(name)},</p>
  <p>Use this code to reset your PriceMyTrip password:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0;color:#1d4ed8">${otp}</p>
  <p>This code expires in ${minutes} minutes. Do not share it with anyone.</p>
  <p style="color:#64748b;font-size:13px">If you did not ask to reset your password, you can ignore this email.</p>
</div>`;

  return { subject: "Your PriceMyTrip password reset code", text, html };
}

export async function sendResetOtpEmail(
  to: string,
  name: string,
  otp: string
): Promise<void> {
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email is not configured on this server");
    }
    console.log(`[dev] Password reset code for ${to}: ${otp}`);
    return;
  }

  await sendMail({ to, ...buildResetEmail(name, otp) });
}