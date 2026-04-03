import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { TicketType } from "../../../ticket-types";
import { price } from "../../tickets/prices";
import { getMarketingMemberPass } from "../../utils/auth";
import { verifyEmail } from "../../utils/input-sanitization";
import { SQLSettings } from "../../utils/sql-settings";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json(
      { message: "Please provide a valid JSON body." },
      { status: 400 },
    );
  }

  if (
    !request.headers.get("username") ||
    !request.headers.get("password") ||
    request.headers.get("password") !==
      getMarketingMemberPass(request.headers.get("username")!)
  ) {
    return Response.json(
      { message: "Invalid marketing member credentials." },
      { status: 401 },
    );
  }

  const { name, grade, email, type, ticketCount, paid } = body;

  if (!name || !grade || !email || !type || !ticketCount || !paid) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  const note = `${name},${grade}`;

  if (email && !verifyEmail(email)) {
    return Response.json(
      { message: "Please provide a valid email address." },
      { status: 400 },
    );
  }

  if (type !== "discounted" && type !== "individual") {
    return Response.json({ message: "Invalid ticket type." }, { status: 400 });
  }

  if (ticketCount * price.getPrice(type, new Date(), "CASH") !== paid) {
    return Response.json(
      {
        message:
          "Paid amount does not match ticket(s) price. Total price is " +
          ticketCount * price.getPrice(type, new Date(), "CASH") +
          " EGP.",
      },
      { status: 400 },
    );
  }

  try {
    let rows =
      await sql`SELECT id FROM marketing_members WHERE username = ${request.headers.get(
        "username",
      )};`;
    const memberID = rows[0]?.id;
    if (!memberID) {
      return Response.json(
        { message: "Invalid marketing member credentials." },
        { status: 401 },
      );
    }

    let settingsRows =
      await sql`SELECT value FROM settings WHERE key = ${SQLSettings.RUSH_HOUR_DATE};`;
    const rushHourDate = settingsRows[0]?.value;
    if (!rushHourDate) {
      return Response.json(
        { message: "Rush hour date is not set." },
        { status: 500 },
      );
    }

    const currentDate = new Date();
    // Compare after stripping away time information whether the dates are equal or not
    if (
      type === TicketType.DISCOUNTED &&
      new Date(rushHourDate).setHours(0, 0, 0, 0) !==
        currentDate.setHours(0, 0, 0, 0)
    ) {
      return Response.json(
        { message: "Rush hour is not today." },
        { status: 400 },
      );
    }

    for (let i = 0; i < ticketCount; i++) {
      const result =
        await sql`INSERT INTO attendees (full_name, email, payment_method, type, phone)
      VALUES (${name}, ${email.toLowerCase()}, 'CASH', ${type}, '201000000000')
      RETURNING id;`;
      if (result.length === 0) {
        return Response.json(
          { message: "Failed to submit ticket." },
          { status: 500 },
        );
      }
      const attendeeID = result[0].id;
      await sql`INSERT INTO rush_hour (marketing_member_id, attendee_id, note)
      VALUES (${memberID}, ${attendeeID}, ${note})
      RETURNING id;`;
    }
  } catch (error) {
    console.error("Error processing marketing ticket submission:", error);
    return Response.json({ message: "Error occurred." }, { status: 400 });
  }
  return Response.json(
    {
      message:
        "Accepted! If there are any errors (e.g. wrong email submitted), please contact your head and keep the cash money.",
      data: { name, grade, email, type, ticketCount },
    },
    { status: 200 },
  );
}
