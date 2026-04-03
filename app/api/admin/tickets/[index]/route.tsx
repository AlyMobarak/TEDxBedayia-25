import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

// Handler for GET requests
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ index: string }>;
  },
) {
  const index = parseInt((await params).index, 10) - 1; // Extract and parse the 'index' parameter
  const itemsPerPage = 10; // Number of rows per request

  if (!canUserAccess(request, ProtectedResource.TICKET_DASHBOARD)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Validate index
  if (isNaN(index) || index < 0) {
    return NextResponse.json(
      { error: "Invalid index parameter" },
      { status: 400 },
    );
  }

  const searchParams = request.nextUrl.searchParams.keys();

  // Checks
  if (
    !["true", "false"].includes(
      request.nextUrl.searchParams.get("sent") ?? "true",
    ) ||
    !["true", "false"].includes(
      request.nextUrl.searchParams.get("paid") ?? "true",
    ) ||
    !["true", "false"].includes(
      request.nextUrl.searchParams.get("admitted") ?? "true",
    )
  ) {
    return NextResponse.json({ error: "Invalid Parameter" }, { status: 400 });
  }

  const filters: { [key: string]: string } = {
    sent: `sent = ${request.nextUrl.searchParams
      .get("sent")
      ?.replaceAll("'", "")}`,
    email: `email = '${request.nextUrl.searchParams
      .get("email")
      ?.replaceAll("'", "")}'`,
    name: `full_name ILIKE '%${request.nextUrl.searchParams
      .get("name")
      ?.replaceAll("'", "")}%'`,
    paid: `paid = ${request.nextUrl.searchParams
      .get("paid")
      ?.replaceAll("'", "")}`,
    admitted:
      request.nextUrl.searchParams.get("admitted")?.replaceAll("'", "") ==
      "false"
        ? `admitted_at IS NULL`
        : "admitted_at IS NOT NULL",
    uuid: `uuid ILIKE '%${request.nextUrl.searchParams
      .get("uuid")
      ?.replaceAll("'", "")}%'`,
  };

  let filterQuery = "WHERE ";
  for (const param of searchParams) {
    if (filters[param]) {
      filterQuery += filters[param] + " AND ";
    }
  }
  if (filterQuery === "WHERE ") {
    filterQuery = "";
  }
  filterQuery = filterQuery.slice(0, -5);

  try {
    // SQL query to fetch paginated applicants using LIMIT and OFFSET
    const result = await sql.query(
      `SELECT id, full_name, email, type AS "ticket_type", 
              payment_method, paid, admitted_at, sent, phone, created_at, uuid
       FROM attendees
       ` +
        filterQuery +
        `
       ORDER BY id ${
         request.nextUrl.searchParams.get("asc") == "true" ? "ASC" : "DESC"
       }
       LIMIT $1 OFFSET $2`,
      [itemsPerPage, index * itemsPerPage],
    );

    // If no rows are returned, return an empty array
    if (result.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Return the paginated applicants as JSON
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error fetching applicants:", error);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 },
    );
  }
}
