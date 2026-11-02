import mysql, { type Pool } from "mysql2/promise";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(60) NOT NULL,
    email VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS trips (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    name VARCHAR(80) NOT NULL,
    request_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_trips_user_created (user_id, created_at),
    CONSTRAINT fk_trips_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    user_id INT UNSIGNED NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const globalForDb = globalThis as unknown as {
  pmtPool?: Pool;
  pmtSchemaReady?: Promise<void>;
};

function getPool(): Pool {
  if (!globalForDb.pmtPool) {
    const database = process.env.DB_NAME ?? process.env.MYSQL_DATABASE;
    const user = process.env.DB_USER ?? process.env.MYSQL_USER;
    if (!database || !user) {
      throw new Error("Database settings missing: set DB_NAME and DB_USER (or MYSQL_DATABASE and MYSQL_USER)");
    }

    globalForDb.pmtPool = mysql.createPool({
      host: process.env.DB_HOST ?? process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
      database,
      connectionLimit: 5,
      timezone: "Z",
      charset: "utf8mb4",
    });
  }

  return globalForDb.pmtPool;
}
console.log("MySQL config being used:", {
  host: process.env.DB_HOST ?? process.env.MYSQL_HOST ?? "localhost",
  database: process.env.DB_NAME ?? process.env.MYSQL_DATABASE,
  user: process.env.DB_USER ?? process.env.MYSQL_USER,
  passwordPresent: Boolean(
    process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD
  ),
});

export async function getDb(): Promise<Pool> {
  const pool = getPool();

  if (!globalForDb.pmtSchemaReady) {
    globalForDb.pmtSchemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }
    })().catch((err) => {
      globalForDb.pmtSchemaReady = undefined;
      throw err;
    });
  }

  await globalForDb.pmtSchemaReady;
  return pool;
}