import { Applicant } from "@/app/admin/types/Applicant";
import { EARLY_BIRD_UNTIL } from "@/app/metadata";
import { neon, Pool, PoolClient } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { TicketType } from "../../../ticket-types";
import { price } from "../../tickets/prices";
import { ResponseCode } from "../../utils/response-codes";
import { scheduleBackgroundEmails } from "./eTicketEmail";

const sql = neon(`${process.env.DATABASE_URL}`);

// ============================================================================
// Constants
// ============================================================================

const GROUP_SIZE = 4;

// ============================================================================
// Types
// ============================================================================

interface PaymentSource {
  method: string;
  identifier: string | null;
}

interface UnpaidAttendee {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  type: TicketType;
  payment_method: string;
  paid: boolean;
  uuid?: string;
  price: number;
  ticket_type?: string;
}

interface GroupInfo {
  grpid: number;
  memberIds: number[];
}

interface AmbiguityResult {
  ambiguous: true;
  found: UnpaidAttendee[];
  groupMembers: Record<string, Applicant[]>;
}

interface ProcessedPayment {
  paidAmount: number;
  paidAttendees: UnpaidAttendee[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parses payment source string into method and identifier.
 * Examples: "TLDA@username" -> { method: "TLDA", identifier: "username" }
 *           "CASH@email@domain.com" -> { method: "CASH", identifier: "email@domain.com" }
 */
function parsePaymentSource(from: string): PaymentSource {
  const [method, ...rest] = from.split("@");
  return {
    method,
    identifier: rest.length > 0 ? rest.join("@") : null,
  };
}

/**
 * Formats payment source for storage in pay_backup.
 * Replaces @ with space in identifier to avoid parsing issues.
 */
function formatPaymentSourceForStorage(source: PaymentSource): string {
  if (source.identifier) {
    return `${source.method}@${source.identifier.replaceAll("@", " ")}`;
  }
  return source.method;
}

/**
 * Batch-generates unique UUIDs, checking against existing ones in DB.
 * Much faster than generating one at a time.
 */
export async function generateBatchUUIDs(
  client: PoolClient,
  count: number,
): Promise<string[]> {
  if (count === 0) return [];

  const uuids: string[] = [];

  while (uuids.length < count) {
    const needed = count - uuids.length;
    const candidates: string[] = [];

    for (let i = 0; i < needed; i++) {
      candidates.push(randomUUID());
    }

    // Check which UUIDs already exist (should be extremely rare)
    // Cast both sides to text to avoid type mismatch issues
    const existing = await client.query(
      `SELECT uuid FROM attendees WHERE uuid::text = ANY($1::text[])`,
      [candidates],
    );

    const existingSet = new Set(existing.rows.map((r) => r.uuid));
    const valid = candidates.filter((u) => !existingSet.has(u));
    uuids.push(...valid);
  }

  return uuids;
}

/**
 * Fetches all unpaid attendees by payment method, with optional email filter for CASH.
 * Uses parameterized queries and row-level locking.
 *
 * NOTE: payment_method column stores the full format (e.g., "TLDA@username", "VFCASH@phonenumber")
 * For CASH payments, we additionally filter by email since CASH doesn't have a unique identifier.
 */
async function fetchUnpaidAttendees(
  client: PoolClient,
  fullPaymentMethod: string,
  method: string,
  identifier: string | null,
  paymentDate: Date,
): Promise<UnpaidAttendee[]> {
  let query;

  if (method === "CASH" && identifier) {
    // CASH payments filter by method AND email
    query = await client.query(
      `SELECT * FROM attendees 
       WHERE payment_method = $1 AND paid = false AND email = $2
       FOR UPDATE`,
      [method, identifier],
    );
  } else {
    // Other payments query by full payment_method (e.g., "TLDA@username")
    query = await client.query(
      `SELECT * FROM attendees 
       WHERE payment_method = $1 AND paid = false
       FOR UPDATE`,
      [fullPaymentMethod],
    );
  }

  return query.rows
    .filter((row) => row.paid === false && row.type !== TicketType.DISCOUNTED)
    .map((row) => ({
      ...row,
      price: price.getPrice(row.type, paymentDate, row.payment_method),
    }));
}

/**
 * Fetches unpaid attendees by specific IDs.
 * Uses parameterized queries and row-level locking.
 * CASH can't reach this stage.
 */
async function fetchUnpaidByIds(
  client: PoolClient,
  ids: number[],
  fullPaymentMethod: string,
  paymentDate: Date,
): Promise<UnpaidAttendee[]> {
  if (ids.length === 0) return [];
  if (fullPaymentMethod.startsWith("CASH")) {
    fullPaymentMethod = "CASH";
  }

  const query = await client.query(
    `SELECT * FROM attendees 
     WHERE id = ANY($1::int[]) AND payment_method = $2 AND paid = false
     FOR UPDATE`,
    [ids, fullPaymentMethod],
  );

  return query.rows
    .filter((row) => row.paid === false)
    .map((row) => ({
      ...row,
      price: price.getPrice(row.type, paymentDate, row.payment_method),
    }));
}

/**
 * Fetches group info for given attendee IDs.
 * Returns a map of attendee ID -> group info.
 */
async function fetchGroupsForAttendees(
  client: PoolClient,
  attendeeIds: number[],
): Promise<Map<number, GroupInfo>> {
  if (attendeeIds.length === 0) return new Map();

  const query = await client.query(
    `SELECT grpid, id1, id2, id3, id4 FROM groups 
     WHERE id1 = ANY($1::int[]) OR id2 = ANY($1::int[]) 
        OR id3 = ANY($1::int[]) OR id4 = ANY($1::int[])`,
    [attendeeIds],
  );

  const groupMap = new Map<number, GroupInfo>();

  for (const row of query.rows) {
    const memberIds = [row.id1, row.id2, row.id3, row.id4];
    const groupInfo: GroupInfo = { grpid: row.grpid, memberIds };

    for (const id of memberIds) {
      groupMap.set(id, groupInfo);
    }
  }

  return groupMap;
}

/**
 * Expands attendee list to include all group members for GROUP tickets.
 */
async function expandGroupMembers(
  client: PoolClient,
  attendees: UnpaidAttendee[],
  fullPaymentMethod: string,
  paymentDate: Date,
): Promise<UnpaidAttendee[]> {
  const groupAttendeeIds = attendees
    .filter((a) => a.type === TicketType.GROUP)
    .map((a) => a.id);

  if (groupAttendeeIds.length === 0) return attendees;

  const groupMap = await fetchGroupsForAttendees(client, groupAttendeeIds);

  // Collect all member IDs we need to fetch
  const allMemberIds = new Set<number>();
  for (const attendee of attendees) {
    allMemberIds.add(attendee.id);
    const groupInfo = groupMap.get(attendee.id);
    if (groupInfo) {
      groupInfo.memberIds.forEach((id) => allMemberIds.add(id));
    }
  }

  // Fetch all members we don't already have
  const existingIds = new Set(attendees.map((a) => a.id));
  const missingIds = [...allMemberIds].filter((id) => !existingIds.has(id));

  if (missingIds.length === 0) return attendees;

  const additionalMembers = await fetchUnpaidByIds(
    client,
    missingIds,
    fullPaymentMethod,
    paymentDate,
  );

  return [...attendees, ...additionalMembers];
}

/**
 * Calculates total price and categorizes attendees by type.
 */
function analyzeUnpaidAttendees(attendees: UnpaidAttendee[]): {
  total: number;
  containsIndividual: boolean;
  containsGroup: boolean;
  individuals: UnpaidAttendee[];
  groupAttendees: UnpaidAttendee[];
} {
  let total = 0;
  let containsIndividual = false;
  let containsGroup = false;
  const individuals: UnpaidAttendee[] = [];
  const groupAttendees: UnpaidAttendee[] = [];

  for (const attendee of attendees) {
    total += attendee.price;
    if (attendee.type === TicketType.GROUP) {
      containsGroup = true;
      groupAttendees.push(attendee);
    } else {
      containsIndividual = true;
      individuals.push(attendee);
    }
  }

  return {
    total,
    containsIndividual,
    containsGroup,
    individuals,
    groupAttendees,
  };
}

/**
 * Checks if payment amount creates an ambiguity that requires user selection.
 * Returns ambiguity data for 431 response if needed.
 */
async function checkForAmbiguity(
  client: PoolClient,
  unpaid: UnpaidAttendee[],
  amount: number,
  total: number,
  containsIndividual: boolean,
  containsGroup: boolean,
  paymentDate: Date,
  fullPaymentMethod: string,
): Promise<AmbiguityResult | null> {
  const individualPrice = price.getPrice(TicketType.INDIVIDUAL, paymentDate);

  // No ambiguity if we can pay for everything or amount is less than one ticket
  if (amount >= total || amount < individualPrice || !containsIndividual) {
    return null;
  }

  // Build the ambiguity response with backward-compatible structure
  let found = [...unpaid];
  const groupMembers: Record<string, Applicant[]> = {};
  const processedIds = new Set<number>();

  if (containsGroup) {
    const groupAttendeeIds = unpaid
      .filter((a) => a.type === TicketType.GROUP)
      .map((a) => a.id);

    const groupMap = await fetchGroupsForAttendees(client, groupAttendeeIds);

    for (const attendee of unpaid) {
      if (
        attendee.type === TicketType.GROUP &&
        !processedIds.has(attendee.id)
      ) {
        const groupInfo = groupMap.get(attendee.id);
        if (!groupInfo) {
          throw new Error("Group not found for attendee #" + attendee.id);
        }

        // Mark all group members as processed
        groupInfo.memberIds.forEach((id) => processedIds.add(id));

        // Get other group member IDs (excluding current attendee)
        const otherMemberIds = groupInfo.memberIds.filter(
          (id) => id !== attendee.id,
        );

        // Remove other group members from found list (show only one rep per group)
        found = found.filter((x) => !otherMemberIds.includes(x.id));

        // Fetch other group members for the groupMembers map
        const otherMembers = await fetchUnpaidByIds(
          client,
          otherMemberIds,
          fullPaymentMethod,
          paymentDate,
        );

        groupMembers[attendee.id] = otherMembers as unknown as Applicant[];
      }
    }
  }

  // Add ticket_type field for backward compatibility
  found = found.map((x) => ({ ...x, ticket_type: x.type }));

  return { ambiguous: true, found, groupMembers };
}

/**
 * Collects unique groups from attendees and returns grouped data.
 */
async function collectUniqueGroups(
  client: PoolClient,
  groupAttendees: UnpaidAttendee[],
): Promise<Map<number, number[]>> {
  if (groupAttendees.length === 0) return new Map();

  const attendeeIds = groupAttendees.map((a) => a.id);
  const groupMap = await fetchGroupsForAttendees(client, attendeeIds);

  // Deduplicate by grpid
  const uniqueGroups = new Map<number, number[]>();
  for (const [, groupInfo] of groupMap) {
    if (!uniqueGroups.has(groupInfo.grpid)) {
      uniqueGroups.set(groupInfo.grpid, groupInfo.memberIds);
    }
  }

  return uniqueGroups;
}

/**
 * Processes payments: updates DB, assigns UUIDs, returns paid attendees.
 * Uses bulk operations for efficiency.
 */
async function processPayments(
  client: PoolClient,
  unpaid: UnpaidAttendee[],
  amount: number,
  paymentDate: Date,
): Promise<ProcessedPayment> {
  const { individuals, groupAttendees } = analyzeUnpaidAttendees(unpaid);
  const isEarlyBird = EARLY_BIRD_UNTIL && paymentDate < EARLY_BIRD_UNTIL;
  const groupPrice = price.getPrice(TicketType.GROUP, paymentDate) * GROUP_SIZE;

  let paidAmount = 0;
  const paidAttendees: UnpaidAttendee[] = [];
  const attendeesToUpdate: { id: number; uuid: string; type: TicketType }[] =
    [];

  // Process individuals first
  for (const attendee of individuals) {
    if (paidAmount + attendee.price <= amount) {
      paidAmount += attendee.price;
      attendeesToUpdate.push({
        id: attendee.id,
        uuid: "", // Will be filled in batch
        type: isEarlyBird ? TicketType.INDIVIDUAL_EARLY_BIRD : attendee.type,
      });
      paidAttendees.push(attendee);
    }
  }

  // Process groups
  const uniqueGroups = await collectUniqueGroups(client, groupAttendees);

  for (const [, memberIds] of uniqueGroups) {
    if (paidAmount + groupPrice <= amount) {
      paidAmount += groupPrice;
      const groupMembers = unpaid.filter((a) => memberIds.includes(a.id));

      for (const member of groupMembers) {
        attendeesToUpdate.push({
          id: member.id,
          uuid: "", // Will be filled in batch
          type: isEarlyBird ? TicketType.GROUP_EARLY_BIRD : member.type,
        });
        paidAttendees.push(member);
      }
    }
  }

  if (attendeesToUpdate.length === 0) {
    return { paidAmount: 0, paidAttendees: [] };
  }

  // Generate UUIDs in batch
  const uuids = await generateBatchUUIDs(client, attendeesToUpdate.length);
  for (let i = 0; i < attendeesToUpdate.length; i++) {
    attendeesToUpdate[i].uuid = uuids[i];
  }

  // Bulk update attendees
  const ids = attendeesToUpdate.map((a) => a.id);
  const uuidList = attendeesToUpdate.map((a) => a.uuid);
  const types = attendeesToUpdate.map((a) => a.type);

  await client.query(
    `UPDATE attendees
     SET paid = true, 
         uuid = data.uuid::uuid,
         type = data.type
     FROM (
       SELECT unnest($1::int[]) AS id, 
              unnest($2::text[]) AS uuid,
              unnest($3::text[]) AS type
     ) AS data
     WHERE attendees.id = data.id`,
    [ids, uuidList, types],
  );

  // Assign UUIDs to paidAttendees for response
  for (let i = 0; i < paidAttendees.length; i++) {
    paidAttendees[i].uuid = attendeesToUpdate[i].uuid;
  }

  return { paidAmount, paidAttendees };
}

/**
 * Sends emails to paid attendees.
 */
function sendEmails(paidAttendees: UnpaidAttendee[]) {
  scheduleBackgroundEmails(
    paidAttendees.map((attendee) => ({
      fullName: attendee.full_name,
      email: attendee.email,
      id: String(attendee.id),
      uuid: attendee.uuid!,
    })),
  );
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Processes a payment for ticket(s).
 *
 * @param from - Payment method with identifier (e.g., "TLDA@username", "CASH@email")
 * @param amount - Amount received as string
 * @param date - Date payment was received (for early bird calculation)
 * @param id_if_needed - Comma-separated attendee IDs for disambiguation
 */
export async function pay(
  from: string,
  amount: string,
  date: string,
  id_if_needed: string,
): Promise<NextResponse> {
  // Validate environment
  if (!process.env.JWT_SECRET) {
    return NextResponse.json(
      { message: "Key is not set. Contact the maintainer." },
      { status: 500 },
    );
  }

  // Parse inputs once
  const paymentSource = parsePaymentSource(from);
  const amountNum = parseInt(amount, 10);
  const paymentDate = new Date(date);

  if (isNaN(amountNum)) {
    return NextResponse.json(
      { message: "Invalid amount provided." },
      { status: 400 },
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Handle refunds (negative amounts)
    if (amountNum < 0) {
      const streamName = formatPaymentSourceForStorage(paymentSource);
      await client.query(
        `INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) 
        VALUES ($1, $2, $3, $4)`,
        [streamName, 0, amount, date],
      );
      return NextResponse.json(
        { refund: true, message: "Refund Inserted." },
        { status: 200 },
      );
    }

    // Start transaction for payment processing
    await client.query("BEGIN");

    // Fetch unpaid attendees
    let unpaid = await fetchUnpaidAttendees(
      client,
      from, // Full payment method string (e.g., "TLDA@username")
      paymentSource.method,
      paymentSource.identifier,
      paymentDate,
    );

    if (unpaid.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          message:
            "Not found. Try Again or Refund (Ticket isn't marked as paid yet).",
        },
        { status: 400 },
      );
    }

    // If specific IDs were provided, filter to those (plus their group members)
    if (id_if_needed !== "") {
      const requestedIds = id_if_needed
        .split(",")
        .map((id) => parseInt(id, 10));
      let filtered = unpaid.filter((a) => requestedIds.includes(a.id));

      // Expand groups for requested IDs
      filtered = await expandGroupMembers(client, filtered, from, paymentDate);

      unpaid = filtered;

      if (unpaid.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { message: "Nobody to pay for." },
          { status: 400 },
        );
      }
    } else {
      // Expand to include all group members if dealing with groups
      unpaid = await expandGroupMembers(client, unpaid, from, paymentDate);
    }

    // Analyze what we have
    const analysis = analyzeUnpaidAttendees(unpaid);

    // Check for ambiguity (partial payment that could apply to multiple tickets)
    if (id_if_needed === "") {
      const ambiguity = await checkForAmbiguity(
        client,
        unpaid,
        amountNum,
        analysis.total,
        analysis.containsIndividual,
        analysis.containsGroup,
        paymentDate,
        from,
      );

      if (ambiguity) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            message:
              "Not enough money to pay for all tickets. Identify using IDs.",
            found: ambiguity.found,
            groupMembers: ambiguity.groupMembers,
          },
          { status: ResponseCode.TICKET_AMBIGUITY },
        );
      }
    }

    // Check for group-only ambiguity (multiple groups, can't pay for all)
    if (analysis.containsGroup && !analysis.containsIndividual) {
      const uniqueGroups = await collectUniqueGroups(
        client,
        analysis.groupAttendees,
      );
      const groupPrice =
        price.getPrice(TicketType.GROUP, paymentDate) * GROUP_SIZE;

      if (
        uniqueGroups.size > 1 &&
        amountNum < uniqueGroups.size * groupPrice &&
        amountNum >= groupPrice
      ) {
        // Build ambiguity response for groups
        const found: UnpaidAttendee[] = [];
        const groupMembers: Record<string, Applicant[]> = {};

        for (const [, memberIds] of uniqueGroups) {
          const rep = unpaid.find((a) => a.id === memberIds[0]);
          if (rep) {
            found.push({ ...rep, ticket_type: rep.type });
            groupMembers[rep.id] = unpaid.filter(
              (a) => memberIds.includes(a.id) && a.id !== rep.id,
            ) as unknown as Applicant[];
          }
        }

        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            message:
              "Not enough money to pay for all tickets. Identify using IDs.",
            found,
            groupMembers,
          },
          { status: ResponseCode.TICKET_AMBIGUITY },
        );
      }
    }

    // Process payments
    const { paidAmount, paidAttendees } = await processPayments(
      client,
      unpaid,
      amountNum,
      paymentDate,
    );

    if (paidAmount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          message: `Nothing was paid. To pay for all tickets: ${analysis.total} EGP. Paying for only one ticket (or an entire group ticket) is accepted as well.`,
        },
        { status: 400 },
      );
    }

    // Log to pay_backup BEFORE sending emails (ensures payment is recorded)
    const streamName = formatPaymentSourceForStorage(paymentSource);
    if (amountNum !== 0) {
      await client.query(`
        INSERT INTO pay_backup (stream, incurred, recieved, recieved_at) 
        VALUES (${streamName}, ${paidAmount}, ${amount}, ${date})
      `);
    }

    // Commit transaction - payment is now final
    await client.query("COMMIT");

    // Send emails (after commit, so payment is safe even if emails fail)
    sendEmails(paidAttendees);

    return NextResponse.json(
      {
        refund: false,
        paid: paidAmount,
        accepted: paidAttendees,
      },
      { status: 200 },
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Payment processing error:", e);
    return NextResponse.json(
      {
        message: "An error occurred processing the payment. Please try again.",
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

// ============================================================================
// Legacy Export (for backward compatibility)
// ============================================================================

export async function safeRandUUID(): Promise<string> {
  let uuid = randomUUID();
  let query = await sql`SELECT * FROM attendees WHERE uuid = ${uuid}`;
  while (query.length !== 0) {
    uuid = randomUUID();
    query = await sql`SELECT * FROM attendees WHERE uuid = ${uuid}`;
  }
  return uuid;
}
