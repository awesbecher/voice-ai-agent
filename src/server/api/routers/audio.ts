import { z } from "zod";

import {
	createTRPCRouter,
	publicProcedure,
	type createTRPCContext,
} from "~/server/api/trpc";
import { OpenAI } from "openai";
import { ElevenLabsClient, stream } from "elevenlabs";
import { env } from "~/env";
import { responses, transcripts, users } from "~/server/db/schema";
import { TRPCError } from "@trpc/server";
import { getTranscriptById } from "~/server/api/routers/transcripts";

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { prompt } from "~/lib/consts";

const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY,
});

const elevenlabs = new ElevenLabsClient({
	apiKey: env.ELEVENLABS_API_KEY,
});

const supabase = createClient(env.SUPABASE_PROJECT_URL, env.SUPABASE_API_KEY);

const bucket = env.SUPABASE_BUCKET;

const getUserIdentity = async (
	ctx: Awaited<ReturnType<typeof createTRPCContext>>,
) => {
	const ip = ctx.headers.get("x-forwarded-for");
	const userAgent = ctx.headers.get("user-agent");
	console.log(ip, userAgent);
	if (!ip || !userAgent) {
		throw new TRPCError({
			message:
				"Could not process your request at this time. Please try again later.",
			code: "INTERNAL_SERVER_ERROR",
		});
	}

	let [user] = await ctx.db
		.insert(users)
		.values({
			ipv4: ip,
			userAgent,
		})
		.returning()
		.onConflictDoNothing();

	if (!user) {
		[user] = await ctx.db.select().from(users).where(eq(users.ipv4, ip));
		if (!user) {
			throw new TRPCError({
				message:
					"There was an error while processing your request. Please try again later.",
				code: "INTERNAL_SERVER_ERROR",
			});
		}
	}

	return user;
};

export const audioRouter = createTRPCRouter({
	transcriptAudio: publicProcedure
		.input(z.object({ base64Audio: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getUserIdentity(ctx);
			const base64Data = input.base64Audio.replace(/^data:.+;base64,/, "");
			const byteCharacters = atob(base64Data);
			const byteNumbers = new Array(byteCharacters.length);

			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}

			const byteArray = new Uint8Array(byteNumbers);
			const blob = new Blob([byteArray], { type: "audio/webm" });

			const file = new File([blob], "audio.webm", {
				type: blob.type,
			});

			const { text } = await openai.audio.transcriptions.create({
				file: file,
				model: "gpt-4o-transcribe",
			});

			const [transcript] = await ctx.db
				.insert(transcripts)
				.values({
					text,
					user: user.ipv4,
				})
				.returning();

			return transcript;
		}),
	generateResponse: publicProcedure
		.input(
			z.object({
				transcript: z.object({
					id: z.string().uuid(),
					text: z.string(),
					createdAt: z.date(),
				}),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { output_text } = await openai.responses.create({
				input: input.transcript.text,
				model: "o4-mini",
				instructions: prompt,
			});

			const row = await getTranscriptById(input.transcript.id);
			if (!row) {
				throw new TRPCError({
					message: "Couldn't find transcript ",
					code: "NOT_FOUND",
				});
			}

			const [response] = await ctx.db
				.insert(responses)
				.values({
					generatedFrom: input.transcript.id,
					text: output_text,
				})
				.returning({ id: responses.id, text: responses.text });

			return response;
		}),
	generateAudio: publicProcedure
		.input(
			z.object({
				response: z.object({ id: z.string().uuid(), text: z.string() }),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { voices } = await elevenlabs.voices.search();

			if (!voices[0]) {
				throw new TRPCError({
					message: "Couldn't get voice to generate audio",
					code: "NOT_FOUND",
				});
			}

			// Convert NodeJS stream to Blob so we can process it better
			const stream = await elevenlabs.textToSpeech.convert(voices[0].voice_id, {
				text: input.response.text,
			});

			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			const chunks: any = [];
			for await (const chunk of stream) {
				chunks.push(chunk);
			}

			let signedUrl = "";

			const fileData = Buffer.concat(chunks);
			const blob = new Blob([fileData], { type: "audio/mpeg" });

			const uuid = randomUUID();

			const { data: dataUpload } = await supabase.storage
				.from(bucket)
				.upload(uuid, blob);
			if (!dataUpload) {
				throw new TRPCError({
					message: "Could not upload file",
					code: "INTERNAL_SERVER_ERROR",
				});
			}
			const { data: dataGetUrl } = await supabase.storage
				.from(bucket)
				.createSignedUrl(uuid, 60 * 10);
			if (!dataGetUrl) {
				throw new TRPCError({
					message: "Could not create signed URL",
					code: "INTERNAL_SERVER_ERROR",
				});
			}

			signedUrl = dataGetUrl.signedUrl;

			await ctx.db
				.update(responses)
				.set({ url: signedUrl })
				.where(eq(responses.id, input.response.id));

			return signedUrl;
		}),
});
