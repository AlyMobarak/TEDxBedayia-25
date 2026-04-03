import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { validateCsrf } from "@/app/api/utils/csrf";
import { SQLSettings } from "@/app/api/utils/sql-settings";
import { EVENT_DATE } from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  if (!canUserAccess(req, ProtectedResource.SUPER_ADMIN)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (
    req.nextUrl.searchParams.get("verification")! !==
    process.env.DESTRUCTIVE_KEY
  ) {
    return NextResponse.json(
      {
        message: "Unauthorized",
      },
      { status: 401 },
    );
  }

  if (new Date() <= EVENT_DATE && process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { message: "Event has not concluded yet." },
      { status: 400 },
    );
  }

  try {
    const sql = neon(`${process.env.DATABASE_URL}`);

    await sql.transaction([
      // Instantly wipe these tables and reset their sequences to 1
      sql`TRUNCATE TABLE groups, rush_hour, marketing_members, pay_backup RESTART IDENTITY CASCADE`,

      // Wipe attendees, but manually set its sequence to 140
      sql`TRUNCATE TABLE attendees CASCADE`,
      sql`ALTER SEQUENCE attendees_id_seq RESTART WITH 140`,

      // Clear the rush hour setting
      sql`UPDATE settings SET value = NULL WHERE key = ${SQLSettings.RUSH_HOUR_DATE}`,
    ]);
    return NextResponse.json({ message: "Data deleted." }, { status: 200 });
  } catch (error) {
    console.error("Error deleting data:", error);
    return NextResponse.json({ message: "Error occurred." }, { status: 400 });
  }
}
