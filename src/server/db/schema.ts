// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { relations, type SQL, sql } from "drizzle-orm";
import { index, pgEnum, pgTableCreator } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `vocal-widget_${name}`);

export const users = createTable("users", (d) => ({
	ipv4: d.cidr().notNull().primaryKey(),
	userAgent: d.text().notNull(),
}));

export const typesEnum = pgEnum("types", ["user", "agent"]);

export const conversations = createTable("conversations", (d) => ({
	id: d.uuid().notNull().primaryKey().defaultRandom(),
	sessionId: d.uuid().notNull(),
	text: d.text().notNull(),
	type: typesEnum().notNull(),
	createdAt: d
		.timestamp({ withTimezone: true })
		.default(sql`CURRENT_TIMESTAMP`)
		.notNull(),
	user: d.cidr().references(() => users.ipv4),
}));

export const flagsEnum = pgEnum("flags", ["usePlayHT"]);

export const flags = createTable("flags", (d) => ({
	id: flagsEnum().primaryKey().unique().notNull(),
	enabled: d.boolean().notNull(),
}));
