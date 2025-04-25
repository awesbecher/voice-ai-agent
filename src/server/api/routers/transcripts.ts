import { db } from "~/server/db";

export const getTranscriptById = async (id: string) => {
	const transcript = await db.query.transcripts.findFirst({
		where: (t, { eq }) => eq(t.id, id),
	});

	return transcript;
};
