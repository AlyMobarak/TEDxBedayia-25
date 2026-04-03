import { TICKET_WINDOW } from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { type NextRequest } from "next/server";
import { TicketType } from "../../../ticket-types";
import { initiateCardPayment } from "../../utils/card-payment";
import { validateCsrfLenient } from "../../utils/csrf";
import { sendBookingConfirmation } from "../../utils/email-helper";
import {
  checkSafety,
  handleMisspelling,
  verifyEmail,
  verifyPaymentMethod,
} from "../../utils/input-sanitization";
import { price } from "../prices";

const sql = neon(`${process.env.DATABASE_URL}`);

// email1, name1, email2, name2, email3, name3, email4, name4,
// phone, paymentMethod
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

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json(
      { message: "Please provide a valid JSON body." },
      { status: 400 },
    );
  }

  let paymentMethod, phone;
  let email1, name1;
  let email2, name2;
  let email3, name3;
  let email4, name4;

  try {
    name1 = body.name1?.toString().trim();
    email1 = body.email1?.toString().trim().toLowerCase();
    name2 = body.name2?.toString().trim();
    email2 = body.email2?.toString().trim().toLowerCase();
    name3 = body.name3?.toString().trim();
    email3 = body.email3?.toString().trim().toLowerCase();
    name4 = body.name4?.toString().trim();
    email4 = body.email4?.toString().trim().toLowerCase();

    phone = body.phone?.toString().trim();
    paymentMethod = body.paymentMethod?.toString().trim();
  } catch (error) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  if (phone === undefined || paymentMethod === undefined) {
    return Response.json(
      { message: "Please fill out all required fields." },
      { status: 400 },
    );
  }

  let emails = [email1, email2, email3, email4];
  emails = emails.map((email) => handleMisspelling(email));

  try {
    let names = [name1, name2, name3, name4];
    let resp = await submitTickets(emails, names, phone, paymentMethod);
    if (resp.status != 200) {
      return resp;
    }

    let ids = (await resp.json()).ids;

    let paymentUrl = "";
    if (paymentMethod === "CARD") {
      let amount = price.getPrice(TicketType.GROUP, new Date(), "CARD") * 4;

      const initiateCardPaymentResponse = await initiateCardPayment(
        name1,
        phone,
        email1,
        amount,
        "group",
        ids.join(","),
      );

      if (!initiateCardPaymentResponse.ok) {
        // delete the attendee record since payment initiation failed.
        await sql`DELETE FROM attendees WHERE id = ${ids[0]} OR id = ${ids[1]} OR id = ${ids[2]} OR id = ${ids[3]};`;
        return initiateCardPaymentResponse;
      }

      paymentUrl = (await initiateCardPaymentResponse.json()).paymentUrl;
    }

    try {
      await sql`INSERT INTO groups (id1, id2, id3, id4) VALUES (${ids[0]}, ${ids[1]}, ${ids[2]}, ${ids[3]});`;
    } catch (error) {
      await sql`DELETE FROM attendees WHERE id = ${ids[0]} OR id = ${ids[1]} OR id = ${ids[2]} OR id = ${ids[3]};`;
      return Response.json(
        {
          message:
            "Error submitting group. Please try again or contact us for help.",
        },
        { status: 500 },
      );
    }

    try {
      // Send email to group leader
      if (paymentMethod == "CASH") {
        await sendBookingConfirmation(
          paymentMethod,
          name1,
          emails[0],
          ids[0],
          TicketType.GROUP,
          paymentUrl,
        );
      }

      if (paymentMethod === "CARD") {
        return Response.json(
          {
            paymentUrl,
            success: true,
          },
          { status: 200 },
        );
      }
    } catch (e) {
      console.error(
        "[CRITICAL ERROR] CONFIRMATION EMAIL NOT SENT TO GROUP LEADER",
        e,
      );
      return Response.json(
        {
          message:
            "Error Occurred. Please contact us for help and provide this code: SMTP_LSA_502.",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        message: `Group Tickets Booked Successfully! Please check your email to continue.${
          paymentMethod === "CASH"
            ? ` Your Group ID is ${ids[0]}. Use it to pay at the school office.`
            : ""
        }`,
        success: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        message:
          "Error submitting group. Please try again or contact us for help.",
      },
      { status: 500 },
    );
  }
}

// Returns a response with the success status and 4 attendee IDs or an error message
async function submitTickets(
  emails: any,
  names: any,
  phone: string | undefined,
  paymentMethod: string | undefined,
) {
  if (!names || !emails || !phone || !paymentMethod || emails.length != 4) {
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

  for (let i = 0; i < emails.length; i++) {
    if (emails[i] === undefined || names[i] === undefined) {
      return Response.json(
        { message: "Please fill out all required fields." },
        { status: 400 },
      );
    }
    if (!verifyEmail(emails[i])) {
      return Response.json(
        {
          message: "Please enter a valid email address for " + names[i] + ".",
        },
        { status: 400 },
      );
    }

    if (!checkSafety(names[i])) {
      return Response.json(
        { message: "Invalid Name: " + names[i] + "." },
        { status: 400 },
      );
    }
  }

  if (phone[0] == "+") {
    phone = phone.slice(1);
  }

  if (phone.length === 11) {
    phone = "2" + phone;
  } else if (phone.length === 13) {
    phone = phone.slice(1);
  }

  if (!checkSafety(phone)) {
    return Response.json({ message: "Invalid Phone Number." }, { status: 400 });
  }

  try {
    // Use parameterized query to prevent SQL injection
    const res = await sql`
      INSERT INTO attendees (email, full_name, payment_method, phone, type) 
      VALUES 
        (${emails[0]}, ${names[0]}, ${paymentMethod}, ${phone}, ${TicketType.GROUP}),
        (${emails[1]}, ${names[1]}, ${paymentMethod}, ${phone}, ${TicketType.GROUP}),
        (${emails[2]}, ${names[2]}, ${paymentMethod}, ${phone}, ${TicketType.GROUP}),
        (${emails[3]}, ${names[3]}, ${paymentMethod}, ${phone}, ${TicketType.GROUP})
      RETURNING *
    `;
    const ids = res.map((row: any) => row.id);

    return Response.json({ success: true, ids });
  } catch (err: any) {
    return Response.json({ success: false }, { status: 500 });
  }
}
