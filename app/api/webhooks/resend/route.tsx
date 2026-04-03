import { neon } from "@neondatabase/serverless";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";

const sql = neon(`${process.env.DATABASE_URL}`);

const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Missing webhook secret" },
      { status: 500 },
    );
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If headers are missing, return error
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json(
      { error: "Error occured -- no svix headers" },
      { status: 400 },
    );
  }

  // Get the body
  const body = await request.text();

  const wh = new Webhook(webhookSecret);
  let evt: any;

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return NextResponse.json({ error: "Error occured" }, { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === "email.bounced" || eventType === "email.failed") {
    const { headers, to, created_at } = evt.data;
    const uuid = headers.filter(
      (header: { name: string; value: string }) =>
        header.name === "X-Entity-Ref-ID",
    )[0]?.value;

    if (!uuid || typeof uuid !== "string" || uuid.trim().length === 0) {
      console.error("Error: Invalid UUID found in headers");
      return NextResponse.json({ error: "Error occured" }, { status: 400 });
    }

    try {
      await sql`UPDATE attendees SET sent = false WHERE uuid = ${uuid}`;
    } catch (err) {
      console.error("Error updating attendee status:", err);
      return NextResponse.json({ error: "Error occured" }, { status: 400 });
    }
    console.warn(`Email failed for ${to[0]} at ${created_at}.`);
  }

  return NextResponse.json({ status: 200 });
}
