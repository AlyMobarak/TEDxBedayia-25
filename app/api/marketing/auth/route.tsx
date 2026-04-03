import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { getMarketingMemberPass } from "../../utils/auth";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return Response.json(
      {
        valid: false,
        message: "Username and password are required.",
      },
      { status: 400 },
    );
  }

  if (!process.env.MARKETING_MEMBER_PASSWORD_GEN) {
    return Response.json(
      {
        valid: false,
        message:
          "Marketing member credentials are not set. Please contact support.",
      },
      { status: 500 },
    );
  }

  let user =
    await sql`SELECT * FROM marketing_members WHERE username = ${username.toLowerCase()}`;

  if (user.length != 0 && password === getMarketingMemberPass(username)) {
    return Response.json({ valid: true, name: user[0].name }, { status: 200 });
  } else {
    return Response.json({ valid: false }, { status: 401 });
  }
}
