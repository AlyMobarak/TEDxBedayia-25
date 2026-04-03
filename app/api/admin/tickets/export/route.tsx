import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

// Handler for GET requests - exports ALL tickets
export async function GET(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    // SQL query to fetch ALL attendees (no pagination)
    const result = await sql`
      SELECT id, full_name, email, type AS "ticket_type",
             payment_method, paid, admitted_at, sent, phone, created_at, uuid
      FROM attendees
      ORDER BY id DESC
    `;

    // Return all attendees as JSON
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error fetching attendees for export:", error);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 },
    );
  }
}
