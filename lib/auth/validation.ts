import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(120, "Email is too long")
  .email("Enter a valid email address");

const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name must be at most 60 characters"),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password must be at most 128 characters"),
});

export const forgotPasswordSchema = z.object({ email });

export const verifyOtpSchema = z.object({
  email,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, "Reset session expired").max(2000),
  password: newPassword,
});

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}