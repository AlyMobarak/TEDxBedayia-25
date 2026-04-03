import { EVENT_DESC, HOST, PHONE, YEAR } from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { promises } from "fs";
import { after } from "next/server";
import nodemailer from "nodemailer";
import path from "path";
import QRCode from "qrcode";
import { Resend } from "resend";
import { TicketEmail } from "../../../components/TicketEmail";
import { EmailRecipient } from "../../utils/email-helper";

const resend = new Resend(process.env.RESEND_API_KEY!);
const sql = neon(`${process.env.DATABASE_URL}`);

// Rate limit delay in ms (800ms = ~1.25 req/s, safely under 2 req/s limit)
const RATE_LIMIT_DELAY_MS = 800;

// Helper function to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Set the 'sent' status of the attendee to true in the database
// If no id is provided, simply return true
async function setSentStatus(id?: string) {
  if (!id) return true;

  const query =
    await sql`UPDATE attendees SET sent = true WHERE id = ${id} RETURNING *`;

  if (query.length === 0) {
    console.error("SQL ERROR; sent = false but it's sent.");
    return false;
  }

  return true;
}

/**
 * Sends emails with rate limiting (600ms delay between each email)
 * to stay under Resend's 2 req/s rate limit.
 * Uses inline QR code attachments with CID for Gmail compatibility.
 */
async function sendEmailsWithRateLimit(
  recipients: EmailRecipient[],
): Promise<EmailRecipient[]> {
  let failed = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    // Add delay between emails (skip for the first one)
    if (i > 0) {
      await delay(RATE_LIMIT_DELAY_MS);
    }

    try {
      // Generate QR code as buffer for inline attachment
      const qrBuffer = await QRCode.toBuffer(recipient.uuid, {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 300,
        type: "png",
      });

      const res = await resend.emails.send({
        from: '"TEDxBedayia eTickets" <tickets@tedxbedayia.com>',
        to: recipient.email,
        subject: "Your TEDxBedayia ticket is here!",
        react: <TicketEmail name={recipient.fullName} uuid={recipient.uuid} />,
        attachments: [
          {
            content: qrBuffer,
            filename: "ticket-qr.png",
            contentId: `ticket-qr-${recipient.uuid}`,
            contentType: "image/png",
          },
        ],
        headers: {
          "X-Entity-Ref-ID": recipient.uuid,
        },
      });

      if (res.error) {
        console.error("Resend Error for", recipient.email, ":", res.error);
        failed.push(recipient);
        continue;
      }

      const status = await setSentStatus(recipient.id);
      if (!status) failed.push(recipient);

      console.log(`Email sent successfully to ${recipient.email}`);
    } catch (e) {
      console.error("Resend Failed for", recipient.email, ":", e);
      failed.push(recipient);
    }
  }

  if (failed.length === 0) return [];

  // Fallback to Gmail if any Resend emails failed
  console.log("Some emails failed with Resend, trying Gmail fallback...");
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: process.env.EMAIL,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN,
      },
    });

    const filePath = path.join(process.cwd(), "public/eTicket-template.html");
    const htmlContent = await promises.readFile(filePath, "utf8");

    for (const recipient of failed) {
      // Replace placeholders in the HTML
      const personalizedHtml = htmlContent
        .replaceAll("${name}", recipient.fullName)
        .replaceAll("${qrCodeURL}", `${HOST}/api/qr?uuid=${recipient.uuid}`)
        .replaceAll("${uuid}", recipient.uuid)
        .replaceAll("{EVENT_DESC}", EVENT_DESC)
        .replaceAll("{PHONE}", PHONE)
        .replaceAll("${year}", YEAR.toString());

      try {
        await transporter.sendMail({
          from: `"TEDxBedayia eTickets" <tedxyouth@bedayia.com>`,
          to: recipient.email,
          attachDataUrls: true,
          subject: `${
            recipient.fullName.split(" ")[0]
          }, your TEDxBedayia'${YEAR} eTicket has Arrived!`,
          html: personalizedHtml,
        });

        const status = await setSentStatus(recipient.id);
        if (status) failed = failed.filter((r) => r !== recipient);
      } catch (e) {
        console.error("GMAIL OR SQL ERROR: ", e);
      }
    }
    return failed;
  } catch (e) {
    console.error("GMAIL FAILED: ", e);
    return failed;
  }
}

/**
 * Schedules emails to be sent in the background after the response is sent.
 * Uses Vercel's fluid compute via Next.js after() API.
 * This function returns immediately and the emails are sent asynchronously.
 */
export function scheduleBackgroundEmails(recipients: EmailRecipient[]): void {
  after(async () => {
    console.log(
      `Background: Starting to send ${recipients.length} emails with rate limiting...`,
    );
    const result = await sendEmailsWithRateLimit(recipients);
    console.log("Background: Email sending completed. Result:", result);
  });
}

/**
 * Sends emails synchronously (blocking).
 * Use this when you need to wait for the result.
 * For non-blocking background sending, use scheduleBackgroundEmails instead.
 */
export async function sendBatchEmail(
  recipients: EmailRecipient[],
): Promise<boolean> {
  const result = await sendEmailsWithRateLimit(recipients);
  return result.length === 0;
}
