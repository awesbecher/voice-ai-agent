import { db } from "~/server/db";

export const getTranscriptById = async (id: string) => {
	const transcript = await db.query.conversations.findFirst({
		where: (c, { eq }) => eq(c.id, id),
	});

	return transcript;
};
