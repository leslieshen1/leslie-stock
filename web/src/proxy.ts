import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOCATION_HOST = "allocation.stockgod.xyz";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];

  if (host === ALLOCATION_HOST && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/allocation";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
