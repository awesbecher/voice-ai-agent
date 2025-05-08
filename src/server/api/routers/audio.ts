import { z } from "zod";

import {
	createTRPCRouter,
	publicProcedure,
	type createTRPCContext,
} from "~/server/api/trpc";
import { OpenAI } from "openai";
import {
	ElevenLabsClient as OriginalElevenLabsClient,
	stream,
} from "elevenlabs";
import { env } from "~/env";
import {
	conversations,
	flags,
	flagsEnum,
	typesEnum,
	users,
} from "~/server/db/schema";
import { TRPCError } from "@trpc/server";
import { getTranscriptById } from "~/server/api/routers/transcripts";

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";

const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY,
});

class ElevenLabsClient extends OriginalElevenLabsClient {
	async generateBlob(text: string) {
		const { voices } = await this.voices.search();

		if (!voices[0]) {
			throw new TRPCError({
				message: "Couldn't get voice to generate audio",
				code: "NOT_FOUND",
			});
		}

		// Convert NodeJS stream to Blob so we can process it better
		const stream = await this.textToSpeech.convert(voices[0].voice_id, {
			text,
		});

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const chunks: any = [];
		for await (const chunk of stream) {
			chunks.push(chunk);
		}

		const fileData = Buffer.concat(chunks);
		const blob = new Blob([fileData], { type: "audio/mpeg" });

		return blob;
	}
}

class PlayHTClient {
	apiKey: string;
	userId: string;
	constructor(apiKey: string, userId: string) {
		this.apiKey = apiKey;
		this.userId = userId;
	}

	async generateBlob(text: string) {
		const response = await fetch("https://api.play.ai/api/v1/tts/stream", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				"X-USER-ID": this.userId,
			},
			body: JSON.stringify({
				model: "PlayDialog",
				text,
				voice:
					"s3://voice-cloning-zero-shot/0b29eab5-834f-4463-b3ad-4e6177d2b145/flynnsaad/manifest.json",
				output_format: "mp3",
			}),
		});

		console.log(response);
		if (!response.ok) {
			throw new TRPCError({
				message: "Error from the PlayHT API",
				code: "INTERNAL_SERVER_ERROR",
			});
		}
		return await response.blob();
	}
}

const VoiceProvider = class {
	playHTFlag: boolean;
	constructor(playHTFlag: boolean) {
		this.playHTFlag = playHTFlag;
	}

	async generateAudioURL(text: string) {
		if (this.playHTFlag) {
			const playht = new PlayHTClient(env.PLAYHT_API_KEY, env.PLAYHT_USER_ID);
			const blob = await playht.generateBlob(text);
			return this.uploadBlobToSupabase(blob);
		}

		const elevenlabs = new ElevenLabsClient({
			apiKey: env.ELEVENLABS_API_KEY,
		});
		const blob = await elevenlabs.generateBlob(text);
		return this.uploadBlobToSupabase(blob);
	}

	async uploadBlobToSupabase(blob: Blob) {
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
		const { signedUrl } = dataGetUrl;
		return signedUrl;
	}
};

const getFlags = async () => {
	const appFlags = await db.select().from(flags);
	if (!appFlags) {
		throw new TRPCError({
			message: "Couldn't get flags",
			code: "INTERNAL_SERVER_ERROR",
		});
	}
	return appFlags;
};

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
		.input(z.object({ base64Audio: z.string(), session: z.string().uuid() }))
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
				.insert(conversations)
				.values({
					text,
					user: user.ipv4,
					sessionId: input.session,
					type: typesEnum.enumValues[0],
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
				instructions: z.string(),
				session: z.string().uuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			console.log(input.instructions);
			const { output_text } = await openai.responses.create({
				input: input.transcript.text,
				model: "o4-mini",
				instructions: input.instructions,
			});

			const row = await getTranscriptById(input.transcript.id);
			if (!row) {
				throw new TRPCError({
					message: "Couldn't find transcript ",
					code: "NOT_FOUND",
				});
			}

			const [conversation] = await ctx.db
				.insert(conversations)
				.values({
					text: output_text,
					sessionId: input.session,
					type: typesEnum.enumValues[1],
				})
				.returning({ id: conversations.id, text: conversations.text });

			return conversation;
		}),
	generateAudio: publicProcedure
		.input(
			z.object({
				response: z.object({ id: z.string().uuid(), text: z.string() }),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const flags = await getFlags();
			const [usePlayHTFlag] = flags.filter((f) => f.id === "usePlayHT");
			if (!usePlayHTFlag) {
				throw new TRPCError({
					message: "Something went wrong!",
					code: "INTERNAL_SERVER_ERROR",
				});
			}
			const vp = new VoiceProvider(usePlayHTFlag.enabled);
			const audioUrl = await vp.generateAudioURL(input.response.text);
			return audioUrl;
		}),
});
