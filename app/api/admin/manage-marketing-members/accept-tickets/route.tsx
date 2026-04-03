import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { EmailRecipient } from "@/app/api/utils/email-helper";
import { ResponseCode } from "@/app/api/utils/response-codes";
import {
  DISCOUNTED_TICKET_PRICE,
  INDIVIDUAL_TICKET_PRICE,
} from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { scheduleBackgroundEmails } from "../../payment-reciever/eTicketEmail";

const client = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.MARKETING_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { memberId, date, paid } = body;

    const dateObj = new Date(
      `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}`,
    );

    if (!memberId || !date || !paid) {
      return NextResponse.json(
        { message: "Member ID, Date, and Paid amount are required." },
        { status: 400 },
      );
    }

    // If paid amount is less than total due, return error
    // 1. Calculate the Total Due dynamically
    const totalDueResult = await client.query(
      `
        SELECT SUM(
          CASE
            -- Case 1: If attendee_id is NULL, price is rush hour (rush code)
            WHEN rh.attendee_id IS NULL THEN $3
            
            -- Case 2: If attendee exists, check the type column
            WHEN a.type = 'individual' THEN $4
            WHEN a.type = 'discounted' THEN $3
            
            -- Fallback if type is unknown
            ELSE 0 
          END
        ) as total_due
        FROM rush_hour rh
        LEFT JOIN attendees a ON rh.attendee_id = a.id
        WHERE rh.marketing_member_id = $1 
          AND rh.created_at::date = $2 
          AND rh.processed = FALSE
  `,
      [memberId, dateObj, DISCOUNTED_TICKET_PRICE, INDIVIDUAL_TICKET_PRICE],
    );

    // 2. Extract the sum (handle potential null if no rows found)
    const totalDue = Number(totalDueResult[0].total_due) || 0;

    // 3. Perform the validation check
    if (paid !== totalDue) {
      return NextResponse.json(
        { message: `Insufficient payment. Total due is ${totalDue}.` },
        { status: ResponseCode.MARKETING_ACTIVITY_OUT_OF_SYNC },
      );
    }

    const result = await client.query(
      `UPDATE rush_hour SET processed = TRUE WHERE marketing_member_id = $1 AND created_at::date = $2 AND processed = FALSE RETURNING *`,
      [memberId, dateObj],
    );

    let stream = "Marketing@" + memberId;

    await client`INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) VALUES (${stream}, ${paid}, ${paid}, NOW())`;

    const results = await Promise.all(
      result.map(async (row) => {
        try {
          const attendeeId = row.attendee_id;
          if (!attendeeId) return null;
          const attendee = await client.query(
            `UPDATE attendees SET paid = TRUE, uuid = $1, sent = TRUE WHERE id = $2 AND paid = FALSE RETURNING *`,
            [randomUUID(), attendeeId],
          );
          // Check if any rows were actually updated
          if (attendee.length === 0) {
            console.log(
              `[MANAGE MARKETING] Attendee ${attendeeId} already paid or not found`,
            );
            return null;
          }
          return {
            fullName: attendee[0].full_name,
            email: attendee[0].email,
            id: attendeeId,
            uuid: attendee[0].uuid,
          };
        } catch (error) {
          console.error(
            "[MANAGE MARKETING] Error processing attendee ID:",
            row.attendee_id,
            error,
          );
          return null;
        }
      }),
    );

    // Filter out nulls and collect valid recipients
    const emailRecipients = results.filter(
      (r): r is EmailRecipient => r !== null,
    );

    scheduleBackgroundEmails(emailRecipients);

    return NextResponse.json({ message: "Success." }, { status: 200 });
  } catch (error) {
    console.error("Error accepting ticket:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
