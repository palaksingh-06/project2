import { after, NextResponse } from "next/server";
import {
  deletePasswordReset,
  findUserByEmail,
  getPasswordReset,
  savePasswordReset,
} from "@/lib/db/repository";
import {
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
} from "@/lib/auth/password-reset";
import { sendResetOtpEmail } from "@/lib/auth/reset-email";
import { firstIssueMessage, forgotPasswordSchema } from "@/lib/auth/validation";

const GENERIC_OK = { ok: true };

export async function POST(request: Request) {
  const parsed = forgotPasswordSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error) },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  try {
    const user = await findUserByEmail(email);
    if (!user) return NextResponse.json(GENERIC_OK);

    const existing = await getPasswordReset(user.id);
    if (
      existing &&
      Date.now() - existing.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return NextResponse.json(GENERIC_OK);
    }

    const otp = generateOtp();
    await savePasswordReset(
      user.id,
      hashOtp(user.id, otp),
      new Date(Date.now() + OTP_TTL_MS)
    );

    after(async () => {
      try {
        await sendResetOtpEmail(user.email, user.name, otp);
      } catch (err) {
        console.error("password reset email failed", err);
        await deletePasswordReset(user.id).catch(() => undefined);
      }
    });

    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    console.error("forgot password failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}