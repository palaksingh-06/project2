import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDb } from "@/lib/db/mysql";
import { DuplicateEmailError } from "@/lib/db/errors";
import type { SavedTrip, SavedTripInput } from "@/lib/trips/schema";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  password_hash: string;
}

export interface PasswordResetRecord {
  userId: string;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

interface ResetRow extends RowDataPacket {
  user_id: number;
  otp_hash: string;
  expires_at: Date;
  attempts: number;
  created_at: Date;
}

interface TripRow extends RowDataPacket {
  id: number;
  name: string;
  request_json: string;
  summary_json: string;
  created_at: Date;
}

const DUPLICATE_ENTRY_ERRNO = 1062;

function toTrip(row: TripRow): SavedTrip {
  return {
    id: String(row.id),
    name: row.name,
    request: JSON.parse(row.request_json),
    summary: JSON.parse(row.summary_json),
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByEmail(
  email: string
): Promise<UserRecord | null> {
  const db = await getDb();
  const [rows] = await db.execute<UserRow[]>(
    "SELECT id, name, email, password_hash FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
  };
}

export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<string> {
  const db = await getDb();

  try {
    const [result] = await db.execute<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      [input.name, input.email, input.passwordHash, new Date()]
    );
    return String(result.insertId);
  } catch (err) {
    if ((err as { errno?: number }).errno === DUPLICATE_ENTRY_ERRNO) {
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

export async function listTrips(
  userId: string,
  limit: number
): Promise<SavedTrip[]> {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.floor(limit));
  const [rows] = await db.execute<TripRow[]>(
    `SELECT id, name, request_json, summary_json, created_at
     FROM trips WHERE user_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ${safeLimit}`,
    [userId]
  );
  return rows.map(toTrip);
}

export async function countTrips(userId: string): Promise<number> {
  const db = await getDb();
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM trips WHERE user_id = ?",
    [userId]
  );
  return Number(rows[0]?.total ?? 0);
}

export async function insertTrip(
  userId: string,
  input: SavedTripInput
): Promise<SavedTrip> {
  const db = await getDb();
  const createdAt = new Date();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO trips (user_id, name, request_json, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      input.name,
      JSON.stringify(input.request),
      JSON.stringify(input.summary),
      createdAt,
    ]
  );

  return {
    id: String(result.insertId),
    ...input,
    createdAt: createdAt.toISOString(),
  };
}

export async function deleteTrip(
  userId: string,
  tripId: string
): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.execute<ResultSetHeader>(
    "DELETE FROM trips WHERE id = ? AND user_id = ?",
    [tripId, userId]
  );
  return result.affectedRows > 0;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const db = await getDb();
  const [rows] = await db.execute<UserRow[]>(
    "SELECT id, name, email, password_hash FROM users WHERE id = ? LIMIT 1",
    [id]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
  };
}

export async function updateUserPassword(
  userId: string,
  passwordHash: string
): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.execute<ResultSetHeader>(
    "UPDATE users SET password_hash = ? WHERE id = ?",
    [passwordHash, userId]
  );
  return result.affectedRows > 0;
}

export async function savePasswordReset(
  userId: string,
  otpHash: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO password_resets (user_id, otp_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE
       otp_hash = VALUES(otp_hash),
       expires_at = VALUES(expires_at),
       attempts = 0,
       created_at = VALUES(created_at)`,
    [userId, otpHash, expiresAt, new Date()]
  );
}

export async function getPasswordReset(
  userId: string
): Promise<PasswordResetRecord | null> {
  const db = await getDb();
  const [rows] = await db.execute<ResetRow[]>(
    `SELECT user_id, otp_hash, expires_at, attempts, created_at
     FROM password_resets WHERE user_id = ? LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    userId: String(row.user_id),
    otpHash: row.otp_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}

export async function consumePasswordResetAttempt(
  userId: string,
  maxAttempts: number
): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE password_resets SET attempts = attempts + 1
     WHERE user_id = ? AND attempts < ?`,
    [userId, maxAttempts]
  );
  return result.affectedRows > 0;
}

export async function deletePasswordReset(userId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM password_resets WHERE user_id = ?", [userId]);
}