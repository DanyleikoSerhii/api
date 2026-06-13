import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { people, titleCast, titles } from '../db/schema.js';
import { escapeLikePattern } from './sql.js';

export function buildPagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

// OR of title / director / actor-name ILIKE — used by both movies list and favorites list.
export function titleSearchCondition(q: string): SQL {
  const pat = `%${escapeLikePattern(q)}%`;
  return or(
    sql`${titles.title} ILIKE ${pat} ESCAPE '\\'`,
    sql`${titles.director} ILIKE ${pat} ESCAPE '\\'`,
    exists(
      db
        .select({ one: sql`1` })
        .from(titleCast)
        .innerJoin(people, eq(titleCast.personId, people.id))
        .where(and(eq(titleCast.titleId, titles.id), sql`${people.name} ILIKE ${pat} ESCAPE '\\'`)),
    ),
  ) as SQL;
}
