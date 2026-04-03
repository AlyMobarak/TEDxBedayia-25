import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { canUserAccess, ProtectedResource } from "../../utils/auth";
import { validateCsrf } from "../../utils/csrf";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if there are any paid tickets that haven't been sent
    const result = await sql`
      SELECT COUNT(*) as count
      FROM attendees
      WHERE paid = true AND sent = false
    `;

    const count = parseInt(result[0].count, 10);

    return Response.json(
      {
        hasUnsent: count > 0,
        count: count,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error checking unsent tickets:", error);
    return Response.json({ message: "Error occurred." }, { status: 500 });
  }
}
