import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgresql://swg:swg@localhost:54329/swg_bounty";

const globalPool = globalThis as typeof globalThis & { __swgPool?: Pool };
export const pool = globalPool.__swgPool ?? new Pool({ connectionString, max: 12 });
if (process.env.NODE_ENV !== "production") globalPool.__swgPool = pool;

export const db = drizzle(pool);
