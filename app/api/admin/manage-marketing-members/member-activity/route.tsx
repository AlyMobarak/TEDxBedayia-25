import { price } from "@/app/api/tickets/prices";
import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.MARKETING_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    let rows =
      await sql`SELECT * FROM rush_hour WHERE processed = FALSE ORDER BY created_at DESC`;

    if (rows.length === 0) {
      return NextResponse.json({ activity: [] }, { status: 200 });
    }
    rows = rows.map((row) => ({
      memberId: row.marketing_member_id,
      attendeeId: row.attendee_id,
      createdAt: row.created_at,
    }));

    let idsOrNull = rows.map((row) => row.attendeeId).filter((x) => x != null);

    let attendees: any[] = [];
    if (idsOrNull.length > 0) {
      attendees = await sql.query(
        `SELECT id, type FROM attendees WHERE id = ANY($1::int[])`,
        [idsOrNull],
      );
    }

    rows = rows.map((row) => {
      const attendee = attendees.find(
        (attendee) => attendee.id === row.attendeeId,
      );
      return {
        ...row,
        price: attendee
          ? price.getPrice(attendee.type, new Date(), "CASH")
          : price.discounted,
      };
    });

    return NextResponse.json({ activity: rows }, { status: 200 });
  } catch (error) {
    console.error("Error fetching member activity:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
