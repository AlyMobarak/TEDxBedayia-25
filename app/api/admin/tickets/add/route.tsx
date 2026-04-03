import { neon, Pool } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { PaymentMethodKey } from "../../../../payment-methods";
import { TicketType } from "../../../../ticket-types";
import { price } from "../../../tickets/prices";
import { canUserAccess, ProtectedResource } from "../../../utils/auth";
import {
  checkPhone,
  checkSafety,
  verifyEmail,
} from "../../../utils/input-sanitization";
import { scheduleBackgroundEmails } from "../../payment-reciever/eTicketEmail";
import { generateBatchUUIDs, safeRandUUID } from "../../payment-reciever/main";

// Constants
const GROUP_SIZE = 4;

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(req: NextRequest) {
  // 1. Auth Check
  if (!canUserAccess(req, ProtectedResource.TICKET_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      type,
      paymentMethod,
      paymentIdentifier,
      isPaid,
      attendees, // Array of { name, email, phone }
    } = body;

    // 2. Basic Validation
    if (!type || !paymentMethod || !attendees || !Array.isArray(attendees)) {
      return NextResponse.json(
        { message: "Missing required fields." },
        { status: 400 },
      );
    }

    // Validate Ticket Type
    const ticketType = type as TicketType;
    if (!Object.values(TicketType).includes(ticketType)) {
      return NextResponse.json(
        { message: "Invalid ticket type." },
        { status: 400 },
      );
    }

    const isGroup =
      ticketType === TicketType.GROUP ||
      ticketType === TicketType.GROUP_EARLY_BIRD;

    // Group Validation: Must have exactly 4 attendees
    if (isGroup && attendees.length !== GROUP_SIZE) {
      return NextResponse.json(
        { message: `Group tickets must have exactly ${GROUP_SIZE} attendees.` },
        { status: 400 },
      );
    }
    // Individual Validation: Must have exactly 1 attendee
    if (!isGroup && attendees.length !== 1) {
      return NextResponse.json(
        { message: "Individual tickets must have exactly 1 attendee." },
        { status: 400 },
      );
    }

    // Validate Attendee Data
    for (const attendee of attendees) {
      const { name, email, phone } = attendee;
      if (!name || !email || !phone) {
        return NextResponse.json(
          { message: "All attendee fields are required." },
          { status: 400 },
        );
      }
      if (!verifyEmail(email)) {
        return NextResponse.json(
          { message: `Invalid email: ${email}` },
          { status: 400 },
        );
      }
      // Basic phone sanitization logic mirroring existing routes
      let sanitizedPhone = phone.trim();
      if (sanitizedPhone.startsWith("+"))
        sanitizedPhone = sanitizedPhone.slice(1);
      if (sanitizedPhone.length === 11) sanitizedPhone = "2" + sanitizedPhone;
      else if (sanitizedPhone.length === 13)
        sanitizedPhone = sanitizedPhone.slice(1);

      if (!checkPhone(sanitizedPhone)) {
        return NextResponse.json(
          { message: `Invalid phone: ${phone}` },
          { status: 400 },
        );
      }
      if (!checkSafety(name)) {
        return NextResponse.json(
          { message: `Invalid name: ${name}` },
          { status: 400 },
        );
      }
      // Update sanitize phone back to object
      attendee.phone = sanitizedPhone;
    }

    // Construct Payment Method String
    let fullPaymentMethod = paymentMethod;
    if (paymentIdentifier) {
      fullPaymentMethod = `${paymentMethod}@${paymentIdentifier}`;
    }

    // 3. Database Insertion
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const insertedIds: number[] = [];
      const recipients = [];

      let uuids: string[] = [];
      if (isPaid) {
        uuids = await generateBatchUUIDs(attendees.length);
      }

      for (const attendee of attendees) {
        const { name, email, phone } = attendee;
        let uuid = uuids.shift()!;

        const res = await client.query(
          `INSERT INTO attendees (email, full_name, phone, type, payment_method, paid, uuid, sent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
          [
            email,
            name,
            phone,
            ticketType,
            fullPaymentMethod,
            isPaid,
            uuid,
            false,
          ], // sent defaults to false, logic below handles sending
        );

        const newId = res.rows[0].id;
        insertedIds.push(newId);

        if (isPaid && uuid != null) {
          recipients.push({
            fullName: name,
            email: email,
            id: String(newId),
            uuid: uuid,
          });
        }
      }

      // Handle Group Linking
      if (isGroup) {
        await client.query(
          `INSERT INTO groups (id1, id2, id3, id4) VALUES ($1, $2, $3, $4)`,
          [insertedIds[0], insertedIds[1], insertedIds[2], insertedIds[3]],
        );
      }

      // 4. Record Payment Backup (If Paid)
      if (isPaid) {
        const ticketPrice = price.getPrice(ticketType, new Date());
        const totalAmount = ticketPrice * attendees.length;

        // Format stream name for pay_backup (replace @ with space in identifier)
        const streamName = paymentIdentifier
          ? `${paymentMethod}@${paymentIdentifier.replaceAll("@", " ")}`
          : paymentMethod;

        await client.query(
          `INSERT INTO pay_backup (stream, incurred, recieved, recieved_at)
                 VALUES ($1, $2, $3, NOW())`,
          [streamName, totalAmount, totalAmount], // Assuming full payment received
        );
      }

      await client.query("COMMIT");

      // 5. Send Emails (Background)
      if (isPaid && recipients.length > 0) {
        scheduleBackgroundEmails(recipients);
      }

      return NextResponse.json({
        success: true,
        message: "Tickets created successfully!",
        ids: insertedIds,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("Error creating tickets:", e);
      return NextResponse.json(
        { message: "Database error occurred." },
        { status: 500 },
      );
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 },
    );
  }
}
