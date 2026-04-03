import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { TicketType } from "@/app/ticket-types";
import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    let { id, type } = await request.json();
    if (!Object.values(TicketType).includes(type)) {
      return Response.json({ message: "Invalid type." }, { status: 400 });
    }
    let q =
      await sql`UPDATE attendees SET type = ${type} WHERE id = ${id} AND type NOT IN ('speaker') AND paid = false RETURNING *`;
    if (q.length === 0) {
      return Response.json({ message: "Invalid request" }, { status: 400 });
    }
    return Response.json({ message: "Success" });
  } catch (e) {
    console.error(e);
    return Response.json({ message: "Invalid request" }, { status: 400 });
  }
}
