import mysql from 'mysql2/promise';

export function createPool(config) {
  return mysql.createPool({
    ...config.db,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 8, // my.cnf allows 25; keep room for backups and admin sessions.
    decimalNumbers: true,
    waitForConnections: true,
  });
}

/** Runs fn inside a transaction, rolling back on any error. */
export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
