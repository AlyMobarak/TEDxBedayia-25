import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { canUserAccess, ProtectedResource } from "../../utils/auth";
import { validateCsrf } from "../../utils/csrf";
import { sendBookingConfirmation } from "../../utils/email-helper";
import { sendBatchEmail } from "../payment-reciever/eTicketEmail";
import { safeRandUUID } from "../payment-reciever/main";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id, email } = await request.json();

  try {
    const result = await sql.query(
      "UPDATE attendees SET email = $1 WHERE id = $2 RETURNING *",
      [email, id],
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Applicant not found" },
        { status: 404 },
      );
    }

    if (
      result[0].paid === false &&
      result[0].payment_method.toString().split("@")[0] === "CASH"
    ) {
      await sendBookingConfirmation(
        result[0].payment_method,
        result[0].full_name,
        email,
        result[0].id,
        result[0].type,
      );
    } else if (result[0].paid === true) {
      const newUUID = await safeRandUUID();
      await sql`
        UPDATE attendees
        SET uuid = ${newUUID}
        WHERE id = ${id} AND paid = true`;

      await sendBatchEmail([
        {
          email,
          fullName: result[0].full_name,
          uuid: newUUID,
          id: String(result[0].id),
        },
      ]);
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
