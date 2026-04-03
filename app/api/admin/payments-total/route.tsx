import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { TicketType } from "../../../ticket-types";
import { price } from "../../tickets/prices";
import { canUserAccess, ProtectedResource } from "../../utils/auth";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function GET(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.PAYMENT_LOGS)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    let query = await sql.query(`SELECT SUM(
    CASE 
        WHEN type = '${TicketType.INDIVIDUAL}' THEN ${price.individual}
        WHEN type = '${TicketType.GROUP}' THEN ${price.group}
        WHEN type = '${TicketType.DISCOUNTED}' THEN ${price.discounted}
        WHEN type = '${TicketType.TEACHER}' THEN ${price.teacher}
        WHEN type = '${TicketType.INDIVIDUAL_EARLY_BIRD}' THEN ${price.individual_early_bird}
        WHEN type = '${TicketType.GROUP_EARLY_BIRD}' THEN ${price.group_early_bird}
        ELSE 0
    END
    ) AS total_price
    FROM attendees WHERE paid = true;`);

    let totalDiscountedCodes =
      await sql`SELECT COUNT(code) FROM rush_hour WHERE processed = TRUE`;

    return Response.json({
      total:
        parseInt(query[0].total_price != undefined ? query[0].total_price : 0) +
        parseInt(totalDiscountedCodes[0].count) * price.discounted,
    });
  } catch (error) {
    return Response.json({ message: "Error occurred." }, { status: 400 });
  }
}
