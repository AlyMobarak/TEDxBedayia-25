import { price } from "@/app/api/tickets/prices";
import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { validateCsrf } from "@/app/api/utils/csrf";
import { EARLY_BIRD_UNTIL } from "@/app/metadata";
import { TicketType } from "@/app/ticket-types";
import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { scheduleBackgroundEmails, sendBatchEmail } from "../eTicketEmail";
import { pay, safeRandUUID } from "../main";

const sql = neon(`${process.env.DATABASE_URL}`);

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  let params = request.nextUrl.searchParams;

  if (!canUserAccess(request, ProtectedResource.PAYMENT_DASHBOARD, "CASH")) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let from = params.get("from");
  if (from === null) {
    return NextResponse.json(
      { message: "Email/ID of Sender is required." },
      { status: 400 },
    );
  }

  let amount = params.get("amount");
  if (amount === null) {
    return NextResponse.json(
      { message: "Amount is required." },
      { status: 400 },
    );
  }

  let date = params.get("date");
  if (date === null) {
    return NextResponse.json({ message: "Date is required." }, { status: 400 });
  }

  // Check if from is a number (ID)
  if (!isNaN(Number(from))) {
    let res = await sql`SELECT * FROM attendees WHERE id = ${Number(from)}`;

    if (res.length === 0) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    if (res[0].paid) {
      return NextResponse.json(
        { message: "User has already paid." },
        { status: 400 },
      );
    }

    let toBePaid = price.getPrice(
      res[0].type,
      new Date(date),
      res[0].payment_method,
    );
    if (res[0].type == TicketType.GROUP) toBePaid = toBePaid * 4;
    if (Number(amount) < toBePaid) {
      return NextResponse.json(
        { message: "Amount is less than the required amount." },
        { status: 400 },
      );
    }

    try {
      if (res[0].type != TicketType.GROUP) {
        let randUUID = await safeRandUUID();
        if (
          EARLY_BIRD_UNTIL &&
          new Date(date) < EARLY_BIRD_UNTIL &&
          res[0].type == TicketType.INDIVIDUAL
        ) {
          await sql`UPDATE attendees SET paid = true, uuid = ${randUUID}, type = ${TicketType.INDIVIDUAL_EARLY_BIRD} WHERE id = ${res[0].id}`;
        } else {
          await sql`UPDATE attendees SET paid = true, uuid = ${randUUID} WHERE id = ${res[0].id}`;
        }
        await sendBatchEmail([
          {
            email: res[0].email,
            fullName: res[0].full_name,
            uuid: randUUID,
            id: String(res[0].id),
          },
        ]);
      } else {
        let groupMembersIDs =
          await sql`SELECT id1, id2, id3, id4 FROM groups WHERE id1 = ${res[0].id} OR id2 = ${res[0].id} OR id3 = ${res[0].id} OR id4 = ${res[0].id}`;

        let randUUIDs = [];
        for (let i = 0; i < 4 * (groupMembersIDs.length ?? 0); i++) {
          randUUIDs.push(await safeRandUUID());
        }

        let ids = [
          groupMembersIDs.map((row) => row.id1),
          groupMembersIDs.map((row) => row.id2),
          groupMembersIDs.map((row) => row.id3),
          groupMembersIDs.map((row) => row.id4),
        ];

        let accepted = await sql.query(
          `
              UPDATE attendees
              SET paid = true, uuid = data.uuid${
                EARLY_BIRD_UNTIL && new Date(date) < EARLY_BIRD_UNTIL
                  ? `, type = '${TicketType.GROUP_EARLY_BIRD}'`
                  : ""
              }
              FROM (
                SELECT unnest($1::int[]) AS id, unnest($2::uuid[]) AS uuid
              ) AS data
              WHERE attendees.id = data.id
              RETURNING *
              `,
          [ids, randUUIDs], // Parameters passed as arrays
        );

        scheduleBackgroundEmails(
          accepted.map((row) => ({
            email: row.email,
            fullName: row.full_name,
            uuid: row.uuid,
            id: String(row.id),
          })),
        );
      }

      if (toBePaid != 0 || Number(amount) != 0) {
        await sql`INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) VALUES (${
          "CASH@" + from
        }, ${toBePaid}, ${amount}, ${date})`;
      }
    } catch (e) {
      console.error(e);
      await sql`UPDATE attendees SET paid = false, uuid = NULL WHERE id = ${from}`;
      return NextResponse.json(
        { message: "Err #7109. Contact Support or Try Again." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { refund: false, paid: toBePaid },
      { status: 200 },
    );
  }

  from = "CASH@" + from.trim();

  return await pay(from, amount, date, params.get("identification") ?? "");
}
