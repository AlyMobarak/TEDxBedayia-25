import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

// Handler for POST requests
export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const id = parseInt((await params).id, 10); // Extract and parse the 'index' parameter
  const { admitted } = await request.json();

  try {
    // Update the admitted status for the specified applicant
    let result;
    if (admitted) {
      result = await sql.query(
        "UPDATE attendees SET admitted_at = NOW() WHERE paid = true AND id = $1 RETURNING *",
        [id],
      );
    } else {
      result = await sql.query(
        "UPDATE attendees SET admitted_at = NULL WHERE paid = true AND id = $1 RETURNING *",
        [id],
      );
    }

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Applicant not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { success: true, applicant: result[0] },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "An Error Occurred" }, { status: 502 });
  }
}
