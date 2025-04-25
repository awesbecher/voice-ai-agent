// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { relations, type SQL, sql } from "drizzle-orm";
import { index, pgTableCreator } from "drizzle-orm/pg-core";

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

export const transcripts = createTable("transcripts", (d) => ({
	id: d.uuid().notNull().primaryKey().defaultRandom(),
	text: d.varchar({ length: 1024 }).notNull(),
	createdAt: d
		.timestamp({ withTimezone: true })
		.default(sql`CURRENT_TIMESTAMP`)
		.notNull(),
	user: d
		.cidr()
		.notNull()
		.references(() => users.ipv4),
}));

export const responses = createTable("responses", (d) => ({
	id: d.uuid().notNull().primaryKey().defaultRandom(),
	text: d.varchar({ length: 1024 }).notNull(),
	createdAt: d
		.timestamp({ withTimezone: true })
		.default(sql`CURRENT_TIMESTAMP`)
		.notNull(),
	generatedFrom: d.uuid().notNull(),
	url: d.varchar({ length: 512 }),
}));

export const responsesRelations = relations(responses, ({ one }) => ({
	generated: one(transcripts, {
		fields: [responses.generatedFrom],
		references: [transcripts.id],
	}),
}));
