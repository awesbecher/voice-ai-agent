import { createTRPCContext } from "../../../server/api/trpc";
import { createCaller } from "~/server/api/root";
import { NextResponse, type NextRequest } from "next/server";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

export const POST = async (req: NextRequest) => {
	// Create context and caller
	const ctx = await createTRPCContext(req);
	const caller = createCaller(ctx);

	try {
		// expecting base64Audio
		const { base64Audio } = await req.json();
		const transcript = await caller.audio.transcriptAudio({ base64Audio });
		if (!transcript) {
			return NextResponse.json(
				{ error: "Internal Server Error" },
				{ status: 500 },
			);
		}
		const response = await caller.audio.generateResponse({ transcript });
		if (!response) {
			return NextResponse.json(
				{ error: "Internal Server Error" },
				{ status: 500 },
			);
		}
		const url = await caller.audio.generateAudio({ response });
		return NextResponse.json(
			{
				url,
			},
			{ status: 200 },
		);
	} catch (cause) {
		if (cause instanceof TRPCError) {
			const httpCode = getHTTPStatusCodeFromError(cause);
			return NextResponse.json({ error: cause }, { status: httpCode });
		}
	}
};
