import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { getPaymentMethods } from "../../../payment-methods";
import { canUserAccess, ProtectedResource } from "../../utils/auth";
import { validateCsrf } from "../../utils/csrf";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  if (!canUserAccess(request, ProtectedResource.PAYMENT_LOGS)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  let query =
    await sql`SELECT stream, incurred, recieved, created_at FROM pay_backup ORDER BY created_at DESC`;

  const paymentMethods = getPaymentMethods();

  const getDisplayName = (identifier: string): string => {
    const builtIn: Record<string, string> = {
      CARD: "Card",
      CASH: "Office",
    };
    return (
      builtIn[identifier] ??
      paymentMethods.find((m) => m.identifier === identifier)?.displayName ??
      identifier
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    );
  };

  return Response.json(
    query.map((row) => {
      const [identifier, rest] = row.stream.toString().split("@");
      const details = rest?.replaceAll(" ", "@") ?? "";
      return {
        stream: `${getDisplayName(identifier)} — ${details}`,
        incurred: row.incurred,
        recieved: row.recieved,
        created_at: row.created_at,
      };
    }),
  );
}
