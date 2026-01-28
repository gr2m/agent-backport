export { auth as proxy } from "@/lib/auth";

export const config = {
  matcher: [
    // Match all routes except:
    // - API routes (handled separately)
    // - Static files
    // - Workflow routes (internal)
    "/((?!api|_next/static|_next/image|favicon.ico|.well-known/workflow).*)",
  ],
};
