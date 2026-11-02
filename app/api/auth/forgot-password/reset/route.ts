import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  deletePasswordReset,
  findUserById,
  updateUserPassword,
} from "@/lib/db/repository";
import {
  passwordFingerprint,
  verifyResetToken,
} from "@/lib/auth/password-reset";
import { firstIssueMessage, resetPasswordSchema } from "@/lib/auth/validation";

const EXPIRED = "This reset session has expired. Please start again.";

export async function POST(request: Request) {
  const parsed = resetPasswordSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error) },
      { status: 400 }
    );
  }

  const { resetToken, password } = parsed.data;

  try {
    const claims = await verifyResetToken(resetToken);
    if (!claims) {
      return NextResponse.json({ error: EXPIRED }, { status: 400 });
    }

    const user = await findUserById(claims.userId);
    if (
      !user ||
      passwordFingerprint(user.passwordHash) !== claims.fingerprint
    ) {
      return NextResponse.json({ error: EXPIRED }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await updateUserPassword(user.id, passwordHash);
    await deletePasswordReset(user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reset password failed", err);
    return NextResponse.json(
      { error: "Could not reset your password. Please try again." },
      { status: 500 }
    );
  }
}