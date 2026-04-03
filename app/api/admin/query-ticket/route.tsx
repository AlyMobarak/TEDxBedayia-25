import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { TicketType } from "../../../ticket-types";
import { price } from "../../tickets/prices";
import { canUserAccess, ProtectedResource } from "../../utils/auth";
import { validateCsrf } from "../../utils/csrf";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  let params = request.nextUrl.searchParams;

  if (!canUserAccess(request, ProtectedResource.QUERY_TICKETS)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  let from = params.get("id");
  if (from === null) {
    return Response.json({ message: "ID is required." }, { status: 400 });
  }

  if (!isNaN(Number(from))) {
    let res = await sql`SELECT * FROM attendees WHERE id = ${Number(from)}`;

    if (res.length === 0) {
      return Response.json({ message: "User not found." }, { status: 404 });
    }

    if (res[0].paid) {
      return Response.json(
        { message: "User has already paid." },
        { status: 400 },
      );
    }

    let email = res[0].email;
    let name = res[0].full_name;
    let amount = price.getPrice(res[0].type, new Date(), res[0].payment_method);
    if (res[0].type == TicketType.GROUP) amount = amount * 4;

    let type = res[0].type;

    return Response.json(
      {
        email,
        name,
        amount,
        type,
      },
      { status: 200 },
    );
  }
}
