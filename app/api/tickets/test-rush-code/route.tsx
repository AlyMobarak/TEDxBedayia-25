import { neon } from "@neondatabase/serverless";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function POST(request: Request) {
  try {
    const { code } = await request.json();
    if (!code) {
      return Response.json({ message: "Code is required." }, { status: 400 });
    }
    const result =
      await sql`SELECT id FROM rush_hour WHERE code = ${code} LIMIT 1;`;
    if (result.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return Response.json(
        { message: "Invalid or expired code." },
        { status: 400 },
      );
    }
    return Response.json(
      { message: "Rush Hour Code exists." },
      { status: 200 },
    );
  } catch (error) {
    return Response.json(
      { message: "Error checking Rush Hour code." },
      { status: 400 },
    );
  }
}
