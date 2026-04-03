import { EVENT_DATE, INDIVIDUAL_TICKET_PRICE } from "@/app/metadata";
import { PaymentMethodKey, paymentOptions } from "@/app/payment-methods";
import { Pool } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { safeRandUUID } from "../../admin/payment-reciever/main";
import {
  checkPhone,
  checkSafety,
  verifyEmail,
} from "../../utils/input-sanitization";

// CORS headers for Usher App access
function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Client");
  return headers;
}

// Handler for GET requests — return ticket prices and payment methods
export async function GET() {
  const headers = corsHeaders();

  return NextResponse.json(
    {
      prices: INDIVIDUAL_TICKET_PRICE,
      paymentMethods: Object.keys(paymentOptions)
        .filter((key) => !["CASH", "CARD", "VFCASH"].includes(key))
        .map((key) => {
          const methodKey = key as PaymentMethodKey;
          const option = paymentOptions[methodKey];
          return {
            identifier: key,
            displayName: option.displayName,
            to: option.to,
          };
        }),
    },
    { status: 200, headers },
  );
}

// Handler for POST requests — register and immediately admit a walk-in attendee
export async function POST(request: NextRequest) {
  const headers = corsHeaders();

  // Parse JSON body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers },
    );
  }

  const name = body.name?.toString().trim();
  const email = body.email?.toString().trim().toLowerCase();
  let phone = body.phone?.toString().trim();
  const key = body.key?.toString().trim();
  const device = body.device?.toString().trim() || "unknown";
  let paymentMethod =
    body.paymentMethod?.toString().trim().toUpperCase() || "CASH";
  const username = body.senderUsername?.toString().trim() || "ON_DOOR";

  paymentMethod += "@" + username;

  if (paymentMethod === "TELDA") {
    paymentMethod = "TLDA";
  } else if (paymentMethod === "INSTAPAY") {
    paymentMethod = "IPN";
  }

  // Validate APP_KEY
  if (key !== process.env.APP_KEY || !process.env.APP_KEY) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers },
    );
  }

  // Validate required fields
  if (!name || !email || !phone) {
    return NextResponse.json(
      { error: "Missing required fields: name, email, phone." },
      { status: 400, headers },
    );
  }

  if (!checkSafety(name) || !verifyEmail(email) || !checkPhone(phone)) {
    return NextResponse.json(
      { error: "Invalid input." },
      { status: 400, headers },
    );
  }

  // remove the plus from phone and add 2 if it starts with 01
  if (phone.startsWith("+2")) {
    phone = phone.substring(1);
  }
  if (phone.startsWith("01")) {
    phone = "2" + phone;
  }

  // Event date threshold check (36 hours)
  const THRESHOLD = 36 * 60 * 60 * 1000;
  const currentDate = new Date();
  const eventDate = EVENT_DATE;

  if (
    Math.abs(currentDate.getTime() - eventDate.getTime()) > THRESHOLD &&
    process.env.PAYMOB_TEST_MODE !== "true" &&
    process.env.NODE_ENV !== "development"
  ) {
    return NextResponse.json(
      { error: `Event not started yet. ${eventDate.toLocaleDateString()}` },
      { status: 400, headers },
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Generate a unique UUID before starting the transaction
    const uuid = await safeRandUUID();

    await client.query("BEGIN");

    // Insert new attendee as paid & admitted on-door
    const result = await client.query(
      `INSERT INTO attendees (email, full_name, phone, type, payment_method, paid, uuid, sent, admitted_at, admitted_by)
         VALUES ($1, $2, $3, 'individual', $4, TRUE, $5, TRUE, NOW(), $6)
         RETURNING *`,
      [email, name, phone, paymentMethod, uuid, device],
    );

    await client.query(
      `INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) VALUES ($1, $2, $3, NOW())`,
      [paymentMethod, INDIVIDUAL_TICKET_PRICE, INDIVIDUAL_TICKET_PRICE],
    );

    await client.query("COMMIT");

    return NextResponse.json(
      { success: true, applicant: result.rows[0] },
      { status: 200, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("On-door ticket error:", error);
    return NextResponse.json(
      { error: "An Error Occurred." },
      { status: 502, headers },
    );
  } finally {
    client.release();
    await pool.end();
  }
}

// Handle preflight OPTIONS request for CORS
export async function OPTIONS() {
  const headers = corsHeaders();
  return new Response(null, { status: 204, headers });
}
