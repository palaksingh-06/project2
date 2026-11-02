import { NextResponse } from "next/server";
import {
  consumePasswordResetAttempt,
  deletePasswordReset,
  findUserByEmail,
  getPasswordReset,
} from "@/lib/db/repository";
import {
  OTP_MAX_ATTEMPTS,
  createResetToken,
  otpMatches,
} from "@/lib/auth/password-reset";
import { firstIssueMessage, verifyOtpSchema } from "@/lib/auth/validation";

const INVALID_CODE = "That code is invalid or has expired. Request a new one.";

function invalidCode() {
  return NextResponse.json({ error: INVALID_CODE }, { status: 400 });
}

export async function POST(request: Request) {
  const parsed = verifyOtpSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error) },
      { status: 400 }
    );
  }

  const { email, otp } = parsed.data;

  try {
    const user = await findUserByEmail(email);
    if (!user) return invalidCode();

    const record = await getPasswordReset(user.id);
    if (!record) return invalidCode();

    if (record.expiresAt.getTime() <= Date.now()) {
      await deletePasswordReset(user.id);
      return invalidCode();
    }

    const allowed = await consumePasswordResetAttempt(
      user.id,
      OTP_MAX_ATTEMPTS
    );
    if (!allowed) {
      await deletePasswordReset(user.id);
      return invalidCode();
    }

    if (!otpMatches(user.id, otp, record.otpHash)) return invalidCode();

    await deletePasswordReset(user.id);
    const resetToken = await createResetToken(user.id, user.passwordHash);

    return NextResponse.json({ resetToken });
  } catch (err) {
    console.error("verify reset code failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}