// POST = Create a new member
// GET = Get all members
// DELETE = Delete a member by ID .. if ID is -1 then delete all members
import {
  canUserAccess,
  getMarketingMemberPass,
  ProtectedResource,
} from "@/app/api/utils/auth";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";

const sql = neon(`${process.env.DATABASE_URL}`);

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.MARKETING_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const members = await sql`SELECT * FROM marketing_members`;

  return NextResponse.json(
    {
      members: members.map((row) => {
        row.password = getMarketingMemberPass(row.username);
        return row;
      }),
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.MARKETING_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ message: "Name is required." }, { status: 400 });
  }

  let username: string = name.split(" ")[0].toLowerCase().replace(/\s+/g, "-");
  username += crypto.randomInt(0, 1000).toString();

  const newMember = await sql`
    INSERT INTO marketing_members (name, username)
    VALUES (${name}, ${username})
    RETURNING *;
  `;

  return NextResponse.json(
    {
      member: {
        ...newMember[0],
        password: getMarketingMemberPass(newMember[0].username),
      },
    },
    { status: 201 },
  );
}

export async function DELETE(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.MARKETING_DASHBOARD)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const id = params.get("id");

  if (id === null) {
    return NextResponse.json({ message: "ID is required." }, { status: 400 });
  }

  if (id === "-1") {
    await sql`DELETE FROM marketing_members`;
    await sql`ALTER SEQUENCE marketing_members_id_seq RESTART WITH 1`;
    return NextResponse.json(
      { message: "All members deleted." },
      { status: 200 },
    );
  }

  const deletedMember = await sql`
        DELETE FROM marketing_members WHERE id = ${Number(id)} RETURNING *;
    `;

  if (deletedMember.length === 0) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 });
  }

  return NextResponse.json({ member: deletedMember[0] }, { status: 200 });
}
