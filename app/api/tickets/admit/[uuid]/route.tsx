import { EVENT_DATE } from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

// Handler for GET requests
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ uuid: string }>;
  },
) {
  // Set CORS headers to allow access from Usher App
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*"); // Allow all origins
  headers.set("Access-Control-Allow-Methods", "GET"); // Allow specific methods
  headers.set("Access-Control-Allow-Headers", "Content-Type, key, X-Client"); // Allow specific headers

  // Check if the request is coming from official app.
  if (
    request.nextUrl.searchParams.get("key") !== process.env.APP_KEY ||
    !process.env.APP_KEY
  ) {
    return Response.json(
      { message: "Unauthorized" },
      { status: 401, headers: headers },
    );
  }
  const uuid = (await params).uuid; // Extract the 'uuid' parameter
  const deviceUID = request.nextUrl.searchParams.get("device") || "unknown";

  const THRESHOLD = 36 * 60 * 60 * 1000;
  const currentDate = new Date();
  const eventDate = EVENT_DATE;

  // Calculate the absolute difference between the current date and the event date
  if (
    Math.abs(currentDate.getTime() - eventDate.getTime()) > THRESHOLD &&
    process.env.PAYMOB_TEST_MODE !== "true" &&
    process.env.NODE_ENV !== "development"
  ) {
    return NextResponse.json(
      { error: `Event not started yet. ${eventDate.toLocaleDateString()}` },
      { status: 400, headers: headers },
    );
  }

  // Validate UUID length (minimum 8 characters for partial matching)
  if (uuid.length < 8) {
    return NextResponse.json(
      { error: "UUID must be at least 8 characters." },
      { status: 400, headers: headers },
    );
  }

  // Check if this is a full UUID (36 chars with dashes) or partial
  const isFullUUID = uuid.length === 36;

  try {
    // Start transaction
    await sql.query("BEGIN");

    // Lock matching row(s) to prevent concurrent admission attempts
    // Use exact match for full UUID, prefix match for partial
    let lockResult;
    if (isFullUUID) {
      lockResult = await sql`
        SELECT * FROM attendees WHERE uuid = ${uuid} FOR UPDATE LIMIT 2`;
    } else {
      // Partial UUID: match prefix safely using LEFT(...) and limit locked rows
      lockResult = await sql`
        SELECT * FROM attendees
           WHERE LEFT(uuid::text, ${uuid.length}) = ${uuid}
           FOR UPDATE
           LIMIT 2`;
    }

    if (lockResult.length === 0) {
      await sql.query("ROLLBACK");
      return NextResponse.json(
        { error: "Applicant not found." },
        { status: 404, headers: headers },
      );
    }

    // Check for multiple matches (only possible with partial UUID)
    if (lockResult.length && lockResult.length > 1) {
      await sql.query("ROLLBACK");
      return NextResponse.json(
        { error: "Multiple tickets found, please insert the full UUID." },
        { status: 400, headers: headers },
      );
    }

    const attendee = lockResult[0];

    // Check if attendee has paid
    if (!attendee.paid) {
      await sql.query("ROLLBACK");
      return NextResponse.json(
        { error: "Applicant has not even paid." },
        { status: 400, headers: headers },
      );
    }

    // Check if already admitted
    if (attendee.admitted_at !== null) {
      // Grace period: allow same device to re-fetch within 2.5 seconds
      const admittedTime = new Date(attendee.admitted_at).getTime();
      if (
        Date.now() - admittedTime < 2.5 * 1000 &&
        attendee.admitted_by === deviceUID
      ) {
        await sql.query("COMMIT");
        return NextResponse.json(
          { success: true, applicant: attendee },
          { status: 200, headers: headers },
        );
      }
      await sql.query("ROLLBACK");
      return NextResponse.json(
        { error: "Applicant already admitted." },
        { status: 400, headers: headers },
      );
    }

    // Admit the attendee (use attendee.uuid from locked row for partial UUID support)
    const result = await sql`
      UPDATE attendees 
       SET admitted_at = NOW(), admitted_by = ${deviceUID} 
       WHERE uuid = ${attendee.uuid} 
         AND paid = TRUE 
         AND admitted_at IS NULL
       RETURNING *`;

    if (result.length === 0) {
      await sql.query("ROLLBACK");
      return NextResponse.json(
        { error: "Applicant is not eligible for admission." },
        { status: 400, headers: headers },
      );
    }
    // Commit transaction
    await sql.query("COMMIT");

    return NextResponse.json(
      { success: true, applicant: result[0] },
      { status: 200, headers: headers },
    );
  } catch (error) {
    await sql.query("ROLLBACK").catch(() => {});
    console.error("Error:", error);
    return NextResponse.json(
      { error: "An Error Occurred." },
      { status: 502, headers: headers },
    );
  }
}

export async function OPTIONS() {
  // Handle preflight OPTIONS request to Allow CORS for Usher App
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*"); // Allow all origins
  headers.set("Access-Control-Allow-Methods", "GET"); // Allow specific methods
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Client",
  ); // Allow specific headers

  return new Response(null, {
    status: 204, // No content
    headers: headers,
  });
}
