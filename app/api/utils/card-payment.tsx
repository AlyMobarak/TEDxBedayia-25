import { neon } from "@neondatabase/serverless";

const sql = neon(`${process.env.DATABASE_URL}`);

export async function initiateCardPayment(
  name: string,
  phone: string,
  email: string,
  amount: number,
  ticketType: string,
  attendeeId: string,
) {
  try {
    var myHeaders = new Headers();
    myHeaders.append("Authorization", "Token " + process.env.PAYMOB_SECRET_KEY);
    myHeaders.append("Content-Type", "application/json");

    var raw = JSON.stringify({
      amount: amount * 100,
      currency: "EGP",
      payment_methods: [
        parseInt(process.env.PAYMOB_VFCASH_INT_ID?.toString() || "0"),
        parseInt(process.env.PAYMOB_CARD_INT_ID?.toString() || "0"),
      ],
      items: [
        {
          name: `${
            ticketType.charAt(0).toUpperCase() + ticketType.slice(1)
          } Ticket`,
          amount: amount * 100,
          description: "",
          quantity: 1,
        },
      ],
      billing_data: {
        first_name: name.split(" ")[0],
        last_name: name.split(" ").slice(1).join(" ") || ".",
        phone_number: phone,
        country: "EGY",
        email: email,
      },
      customer: {
        first_name: name.split(" ")[0],
        last_name: name.split(" ").slice(1).join(" ") || ".",
        email: email,
      },
    });

    var requestOptions = {
      method: "POST",
      headers: myHeaders,
      body: raw,
    };

    const response = await fetch(
      process.env.PAYMOB_BASE_API_URL ||
        "https://accept.paymob.com/v1/intention/",
      requestOptions,
    );
    const result = await response.json();

    if (!response.ok) {
      console.error("Paymob API error:", result);
      return new Response(result.message || "Failed to initiate payment", {
        status: 500,
      });
    }

    // Save the payment intent ID to the attendee record for future reference
    const ids = attendeeId
      .toString()
      .split(",")
      .map((id) => parseInt(id, 10));

    const newMethod = "CARD@" + result.intention_order_id;
    const updated =
      (
        await sql.query(
          `
          UPDATE attendees
          SET payment_method = $1
          WHERE id = ANY($2::int[])
          AND paid = FALSE
          RETURNING id
        `,
          [newMethod, ids],
        )
      ).length === ids.length;

    if (!updated) {
      return Response.json(
        {
          message:
            "Failed to update attendee payment method. Please contact support.",
        },
        { status: 500 },
      );
    }

    const paymentUrl = `${process.env.PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${process.env.PAYMOB_PUBLIC_KEY}&clientSecret=${result.client_secret}`;

    return Response.json(
      {
        paymentUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error initiating payment:", error);
    return Response.json(
      { message: "Error occurred while trying to initiate payment." },
      {
        status: 500,
      },
    );
  }
}
