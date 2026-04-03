import { EVENT_DATE } from "@/app/metadata";
import { Client } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

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

  // Custom error to carry HTTP status out of the transaction
  class AdmitError extends Error {
    constructor(
      public readonly httpStatus: number,
      message: string,
    ) {
      super(message);
    }
  }

  const client = new Client(process.env.DATABASE_URL!);
  await client.connect();

  try {
    await client.query("BEGIN");

    // Lock matching row(s) to prevent concurrent admission attempts
    let lockResult;
    if (isFullUUID) {
      lockResult = await client.query(
        `SELECT * FROM attendees WHERE uuid = $1 FOR UPDATE LIMIT 2`,
        [uuid],
      );
    } else {
      // Partial UUID: match prefix safely using starts_with and limit locked rows
      lockResult = await client.query(
        `SELECT * FROM attendees
           WHERE starts_with(uuid::text, $1::text)
           FOR UPDATE
           LIMIT 2`,
        [uuid],
      );
    }

    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AdmitError(404, "Applicant not found.");
    }

    if (lockResult.rows.length > 1) {
      await client.query("ROLLBACK");
      throw new AdmitError(
        400,
        "Multiple tickets found, please insert the full UUID.",
      );
    }

    const attendee = lockResult.rows[0];

    if (!attendee.paid) {
      await client.query("ROLLBACK");
      throw new AdmitError(400, "Applicant has not even paid.");
    }

    if (attendee.admitted_at !== null) {
      // Grace period: allow same device to re-fetch within 2.5 seconds
      const admittedTime = new Date(attendee.admitted_at).getTime();
      if (
        Date.now() - admittedTime < 2.5 * 1000 &&
        attendee.admitted_by === deviceUID
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: true, applicant: attendee },
          { status: 200, headers: headers },
        );
      }
      await client.query("ROLLBACK");
      throw new AdmitError(400, "Applicant already admitted.");
    }

    // Admit the attendee (use attendee.uuid from locked row for partial UUID support)
    const updateResult = await client.query(
      `UPDATE attendees
         SET admitted_at = NOW(), admitted_by = $1
         WHERE uuid = $2
           AND paid = TRUE
           AND admitted_at IS NULL
         RETURNING *`,
      [deviceUID, attendee.uuid],
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AdmitError(400, "Applicant is not eligible for admission.");
    }

    await client.query("COMMIT");

    return NextResponse.json(
      { success: true, applicant: updateResult.rows[0] },
      { status: 200, headers: headers },
    );
  } catch (error) {
    if (error instanceof AdmitError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.httpStatus, headers: headers },
      );
    }
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error:", error);
    return NextResponse.json(
      { error: "An Error Occurred." },
      { status: 502, headers: headers },
    );
  } finally {
    await client.end();
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
