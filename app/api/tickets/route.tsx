import { TICKET_WINDOW } from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { TicketType } from "../../ticket-types";
import { sendBatchEmail } from "../admin/payment-reciever/eTicketEmail";
import { safeRandUUID } from "../admin/payment-reciever/main";
import { initiateCardPayment } from "../utils/card-payment";
import { validateCsrfLenient } from "../utils/csrf";
import { sendBookingConfirmation } from "../utils/email-helper";
import {
  checkPhone,
  checkSafety,
  handleMisspelling,
  verifyEmail,
  verifyPaymentMethod,
} from "../utils/input-sanitization";
import { price } from "./prices";

const sql = neon(`${process.env.DATABASE_URL}`);

// email, name, phone, paymentMethod
export async function POST(request: NextRequest) {
  const csrfError = validateCsrfLenient(request);
  if (csrfError) return csrfError;

  if (new Date() < TICKET_WINDOW[0] || new Date() > TICKET_WINDOW[1]) {
    if (
      process.env.PAYMOB_TEST_MODE !== "true" &&
      process.env.NODE_ENV !== "development"
    )
      return Response.json(
        { message: "Ticket sales are currently closed." },
        { status: 400 },
      );
  }
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json(
      { message: "Please provide a valid JSON body." },
      { status: 400 },
    );
  }

  let paymentMethod, name, email, phone, code;
  try {
    name = body.name?.toString().trim();
    email = body.email?.toString().trim().toLowerCase();
    phone = body.phone?.toString().trim();
    paymentMethod = body.paymentMethod?.toString().trim();
    if (body.code) code = body.code?.toString().trim();
  } catch (error) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  paymentMethod = verifyPaymentMethod(paymentMethod);
  if (paymentMethod === undefined || paymentMethod.split("@").length > 2) {
    return Response.json(
      { message: "Please enter a valid payment method." },
      { status: 400 },
    );
  }

  try {
    return await submitOneTicket(email!, name!, phone!, paymentMethod, code);
  } catch (error) {
    return Response.json({ message: "Error occurred." }, { status: 400 });
  }
}

async function submitOneTicket(
  email: string,
  name: string,
  phone: string,
  paymentMethod: string | undefined,
  code: string | undefined = undefined,
) {
  email = handleMisspelling(email);
  if (!verifyEmail(email)) {
    return Response.json(
      {
        message: "Please enter a valid email address.",
      },
      { status: 400 },
    );
  }

  if (
    email === undefined ||
    name === undefined ||
    phone === undefined ||
    paymentMethod === undefined
  ) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  if (phone[0] == "+") {
    phone = phone.slice(1);
  }
  if (phone.length === 11) {
    phone = "2" + phone;
  } else if (phone.length === 13) {
    phone = phone.slice(1);
  }

  if (!checkPhone(phone)) {
    return Response.json({ message: "Invalid Phone Number." }, { status: 400 });
  }

  if (!checkSafety(name)) {
    return Response.json({ message: "Invalid Name." }, { status: 400 });
  }

  if (!verifyEmail(email)) {
    return Response.json(
      {
        message: "Please enter a valid email address.",
      },
      { status: 400 },
    );
  }

  let id;
  try {
    let res = await sql.query(
      `INSERT INTO attendees (email, full_name, payment_method, phone, type) VALUES ($1::text, $2::text, $3::text, $4::text, $5::text) RETURNING *;`,
      [
        email,
        name,
        paymentMethod,
        phone,
        code ? TicketType.DISCOUNTED : TicketType.INDIVIDUAL,
      ],
    );
    id = res[0].id;
  } catch (error) {
    return Response.json(
      {
        message: "Error occurred. Please try again or contact us for help.",
      },
      { status: 400 },
    );
  }

  if (code) {
    let result =
      await sql`UPDATE rush_hour SET code = NULL, attendee_id = ${id} WHERE code = ${code} RETURNING processed;`;

    if (result.length === 0) {
      // invalid code.. delete the attendee record since the code is invalid.
      await sql`DELETE FROM attendees WHERE id = ${id}`;
      await sql`SELECT setval('attendees_id_seq', (SELECT MAX(id) FROM attendees));`;
      return Response.json(
        { message: "Invalid rush hour code. Please try again." },
        { status: 400 },
      );
    }

    if (result[0].processed === true) {
      let uuid = await safeRandUUID();
      await sql`UPDATE attendees SET paid = TRUE, uuid = ${uuid} WHERE id = ${id} AND paid = FALSE RETURNING *`;
      await sendBatchEmail([{ email, fullName: name, uuid, id }]);
    }

    return Response.json(
      {
        message: result[0].processed
          ? `The ticket was sent to your email! Congratulations for your Rush Hour Ticket!`
          : `Our team is reviewing rush hour payments at this moment. Your ticket will be sent to your email once the payment is confirmed.`,
        success: true,
      },
      { status: 200 },
    );
  }

  // Paymob specific implementation
  let paymentUrl = "";
  if (paymentMethod === "CARD") {
    let amount = price.getPrice(TicketType.INDIVIDUAL, new Date(), "CARD");
    const initiateCardPaymentResponse = await initiateCardPayment(
      name,
      phone,
      email,
      amount,
      "individual",
      id,
    );

    if (!initiateCardPaymentResponse.ok) {
      // delete the attendee record since payment initiation failed.
      await sql`DELETE FROM attendees WHERE id = ${id}`;
      await sql`SELECT setval('attendees_id_seq', (SELECT MAX(id) FROM attendees));`;
      return initiateCardPaymentResponse;
    }

    paymentUrl = (await initiateCardPaymentResponse.json()).paymentUrl;

    return Response.json(
      {
        paymentUrl: paymentUrl,
        success: true,
      },
      { status: 200 },
    );
  }

  try {
    // send payment details and next steps.
    if (paymentMethod == "CASH") {
      await sendBookingConfirmation(
        paymentMethod,
        name,
        email,
        id,
        TicketType.INDIVIDUAL,
        paymentUrl,
      );
    }

    return Response.json(
      {
        message: `Ticket Booked Successfully!${
          paymentMethod === "CASH"
            ? ` Please check your email to continue. Your Attendee ID is ${id}. Use it to pay at the school office.`
            : ""
        }`,
        success: true,
      },
      { status: 200 },
    );
  } catch (error) {
    // failed to send confirmation.. delete email so person can try again.
    await sql`DELETE FROM attendees WHERE id = ${id}`;
    await sql`SELECT setval('attendees_id_seq', (SELECT MAX(id) FROM attendees));`;
    console.error(
      "[CRITICAL ERROR] Sending email failed. Deleting attendee record.",
    );
    console.error(error);
    return Response.json(
      {
        message:
          "Error Occurred. Please try again or contact us for help: SMTP_ERR_001.",
      },
      { status: 400 },
    );
  }
}

export async function GET() {
  // Return number of tickets and number of paid tickets
  let query = await sql`SELECT COUNT(*) FROM attendees;`;
  let query2 = await sql`SELECT COUNT(*) FROM attendees WHERE paid = true;`;
  let query3 =
    await sql`SELECT COUNT(*) FROM attendees WHERE paid = true AND type NOT IN ('speaker', 'giveaway');`;

  let totalDiscountedCodes =
    await sql`SELECT COUNT(code) FROM rush_hour WHERE processed = TRUE`;

  return Response.json(
    {
      total: parseInt(query[0].count) + parseInt(totalDiscountedCodes[0].count),
      paid: parseInt(query2[0].count) + parseInt(totalDiscountedCodes[0].count),
      actual:
        parseInt(query3[0].count) + parseInt(totalDiscountedCodes[0].count),
    },
    { status: 200 },
  );
}
