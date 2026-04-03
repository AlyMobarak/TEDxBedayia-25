import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { canUserAccess, ProtectedResource } from "../../utils/auth";
import { validateCsrf } from "../../utils/csrf";
import { sendBatchEmail } from "../payment-reciever/eTicketEmail";
import { safeRandUUID } from "../payment-reciever/main";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  let params = request.nextUrl.searchParams;

  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  let id = params.get("id");
  if (id === null) {
    return Response.json({ message: "ID is required." }, { status: 400 });
  }

  try {
    let q = await sql`SELECT * FROM attendees WHERE id = ${id}`;
    if (q.length !== 1) {
      return Response.json({ message: "Attendee not found." }, { status: 404 });
    }

    if (q[0].uuid === null && q[0].paid == true) {
      let uuid = await safeRandUUID();
      await sql`UPDATE attendees SET uuid = ${uuid} WHERE id = ${id}`;
      q[0].uuid = uuid;
    }

    await sendBatchEmail([
      {
        email: q[0].email,
        fullName: q[0].full_name,
        uuid: q[0].uuid,
        id: String(q[0].id),
      },
    ]);
    return Response.json(
      { message: `Email sent to ${q[0].email}.` },
      { status: 200 },
    );
  } catch (error) {
    return Response.json({ message: "Error occurred." }, { status: 400 });
  }
}
