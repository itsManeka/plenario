import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/plenario";

export const sql = postgres(url, { max: Number(process.env.DB_POOL ?? 10) });
export const db = drizzle(sql, { schema });
export { schema };
