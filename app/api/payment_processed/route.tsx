import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { scheduleBackgroundEmails } from "../admin/payment-reciever/eTicketEmail";
import { safeRandUUID } from "../admin/payment-reciever/main";

const sql = neon(`${process.env.DATABASE_URL}`);

type Primitive = string | number | boolean | null | undefined;

/**
 * Safely gets a nested value from an object using dot-separated path.
 */
function getNestedValue<T extends Record<string, any>>(
  obj: T,
  path: string,
): Primitive {
  return path
    .split(".")
    .reduce<any>((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

/**
 * Given an object and an array of dot-separated keys,
 * returns a concatenated string of values in lexicographic key order.
 */
function stringifyValues<T extends Record<string, any>>(
  obj: T,
  keys: string[],
): string {
  return [...keys]
    .sort() // sort lexicographically
    .map((key) => {
      const value = getNestedValue(obj, key);
      return value != null ? String(value) : "";
    })
    .join("");
}

export async function POST(request: NextRequest) {
  try {
    // ensure the request is coming from Paymob by HMAC authentication
    const fields = [
      "amount_cents",
      "created_at",
      "currency",
      "error_occured",
      "has_parent_transaction",
      "id",
      "integration_id",
      "is_3d_secure",
      "is_auth",
      "is_capture",
      "is_refunded",
      "is_standalone_payment",
      "is_voided",
      "order.id",
      "owner",
      "pending",
      "source_data.pan",
      "source_data.sub_type",
      "source_data.type",
      "success",
    ];
    // if a field has a dot in its name, it means it's a nested field in the JSON object

    const searchParams = request.nextUrl.searchParams;
    const receivedHmac = searchParams.get("hmac");

    // step 1: Sort the parameters received in the callback in lexicographical order based on their keys.
    const payload = await request.json();
    if (payload.type.toString().toLowerCase() !== "transaction")
      return new Response("Ignored non-transaction callback.", { status: 200 });
    const transaction = payload.obj;

    // step 2: Depending on the type of callback received, concatenate the values of the keys/parameters into a single string. This string will be used to calculate the HMAC in the next step.
    const hmacString = stringifyValues(transaction, fields);

    // step 3: Compute the HMAC using the SHA-512 hashing algorithm and the secret key provided by Paymob. The computed HMAC should be in hexadecimal format.
    const encoder = new TextEncoder();
    const keyData = encoder.encode(process.env.PAYMOB_HMAC_SECRET || "");
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      encoder.encode(hmacString),
    );

    const computedHmac = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computedHmac !== receivedHmac) {
      return new Response("Invalid Attempt", { status: 401 });
    }

    const orderId = transaction.order.id;

    if (
      transaction.success &&
      ((transaction.payment_key_claims &&
        transaction.payment_key_claims.next_payment_intention &&
        !transaction.payment_key_claims.next_payment_intention
          .toString()
          .startsWith("pi_test")) ||
        process.env.PAYMOB_TEST_MODE === "true")
    ) {
      // update the payment status in the database using the orderId & check if user already paid then don't do anything
      let members;
      try {
        members = await sql`
          SELECT * FROM attendees WHERE payment_method = ${
            "CARD@" + orderId
          } AND paid = FALSE;
        `;
      } catch (error) {
        console.error("Database query error:", error);
        return new Response("Database Error", { status: 500 });
      }

      if ((members.length || 0) > 0) {
        const ids = members.map((row: any) => parseInt(row.id));
        // const arrayLiteral = `{${ids.join(",")}}`;

        const uuids: string[] = [];
        for (let i = 0; i < ids.length; i++) {
          uuids.push(await safeRandUUID());
        }

        const result = await sql.query(
          `UPDATE attendees SET paid = true, uuid = data.uuid FROM ( SELECT unnest($1::int[]) AS id, unnest($2::uuid[]) AS uuid ) AS data WHERE attendees.id = data.id RETURNING *;`,
          [ids, uuids], // Parameters passed as arrays
        );
        const updated = result.length === ids.length;

        if (updated) {
          // Schedule emails to be sent in background (non-blocking)
          scheduleBackgroundEmails(
            result.map((row) => ({
              email: row.email,
              fullName: row.full_name,
              uuid: row.uuid,
              id: String(row.id),
            })),
          );

          await sql`INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) VALUES (${
            "CARD@" + orderId
          }, ${transaction.amount_cents / 100}, ${
            transaction.amount_cents / 100
          }, ${transaction.created_at}::timestamptz);`;
        } else {
          console.error(`Failed to update payment status for order ${orderId}`);
        }
      } else {
        console.log(`No unpaid attendees found for order ${orderId}`);
      }
    } else {
      // no marking needed if payment declined
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error processing payment callback:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // request is coming from client... check the payment status and respond accordingly
  // no need to check HMAC here since this is just a redirect.
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get("success") === "true") {
    return NextResponse.redirect("https://tedxbedayia.com/book/success");
  }

  return NextResponse.redirect("https://tedxbedayia.com/book/failure");
}
