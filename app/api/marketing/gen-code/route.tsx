import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { TicketType } from "../../../ticket-types";
import { price } from "../../tickets/prices";
import { getMarketingMemberPass } from "../../utils/auth";
import { SQLSettings } from "../../utils/sql-settings";

const sql = neon(`${process.env.DATABASE_URL}`);

// Returns a random code in the format "XXXX-XXXX" alphanumeric
async function randCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
    if (i === 3) code += "-"; // Add hyphen after the first four characters
  }
  return code;
}

async function safeRandCode() {
  let code;
  do {
    code = await randCode();
    // Check if the code already exists in the database
    const rows = await sql`SELECT id FROM rush_hour WHERE code = ${code};`;
    if (rows.length === 0) {
      return code; // Return the code if it is unique
    }
  } while (true); // Repeat until a unique code is found
}

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
    request.headers.get("password") !==
      getMarketingMemberPass(request.headers.get("username")!)
  ) {
    return Response.json(
      { message: "Invalid marketing member credentials." },
      { status: 401 },
    );
  }

  const { name, grade, type, ticketCount, paid } = body;

  if (!name || !grade || !type || !ticketCount || !paid) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  const note = `${name},${grade}`;

  if (type !== "discounted") {
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

  let codes: string[] = [];

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
      const code = await safeRandCode();
      await sql`INSERT INTO rush_hour (marketing_member_id, code, note)
      VALUES (${memberID}, ${code}, ${note})
      RETURNING id;`;
      codes.push(code);
    }
  } catch (error) {
    console.error("Error processing marketing ticket submission:", error);
    return Response.json({ message: "Error occurred." }, { status: 400 });
  }
  return Response.json(
    {
      message: "Ticket submission successful.",
      codes,
    },
    { status: 200 },
  );
}
