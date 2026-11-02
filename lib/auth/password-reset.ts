import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const RESET_TOKEN_TTL_SECONDS = 10 * 60;

const RESET_PURPOSE = "password-reset";

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters");
  }
  return secret;
}

function deriveKey(label: string): Buffer {
  return createHmac("sha256", getAuthSecret()).update(label).digest();
}

export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

export function hashOtp(userId: string, otp: string): string {
  return createHmac("sha256", deriveKey("pmt-otp"))
    .update(`${userId}:${otp}`)
    .digest("hex");
}

export function otpMatches(
  userId: string,
  otp: string,
  storedHash: string
): boolean {
  const expected = Buffer.from(hashOtp(userId, otp), "hex");
  const actual = Buffer.from(storedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 24);
}

export async function createResetToken(
  userId: string,
  passwordHash: string
): Promise<string> {
  return new SignJWT({
    purpose: RESET_PURPOSE,
    pwf: passwordFingerprint(passwordHash),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${RESET_TOKEN_TTL_SECONDS}s`)
    .sign(deriveKey("pmt-reset-token"));
}

export async function verifyResetToken(
  token: string
): Promise<{ userId: string; fingerprint: string } | null> {
  const key = deriveKey("pmt-reset-token");

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });

    if (
      payload.purpose !== RESET_PURPOSE ||
      !payload.sub ||
      typeof payload.pwf !== "string"
    ) {
      return null;
    }

    return { userId: payload.sub, fingerprint: payload.pwf };
  } catch {
    return null;
  }
}