import { NextResponse, type NextRequest } from "next/server";

export const GET = (req: NextRequest) => {
	return NextResponse.json({
		ip: req.headers.get("x-forwarded-for"),
	});
};
