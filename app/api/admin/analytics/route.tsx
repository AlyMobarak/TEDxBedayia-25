import { canUserAccess, ProtectedResource } from "@/app/api/utils/auth";
import {
  DISCOUNTED_TICKET_PRICE,
  GROUP_EARLY_PRICE,
  GROUP_TICKET_PRICE,
  INDIVIDUAL_EARLY_PRICE,
  INDIVIDUAL_TICKET_PRICE,
  TEACHER_TICKET_PRICE,
} from "@/app/metadata";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

// Price mapping for revenue calculation
const TICKET_PRICES: Record<string, number> = {
  individual: INDIVIDUAL_TICKET_PRICE,
  group: GROUP_TICKET_PRICE,
  discounted: DISCOUNTED_TICKET_PRICE,
  teacher: TEACHER_TICKET_PRICE,
  individual_early_bird: INDIVIDUAL_EARLY_PRICE,
  group_early_bird: GROUP_EARLY_PRICE,
  speaker: 0,
  giveaway: 0,
};

export async function GET(request: NextRequest) {
  if (!canUserAccess(request, ProtectedResource.ANALYTICS)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = neon(`${process.env.DATABASE_URL}`);

    // 1. Sales over time (daily counts for last 30 days)
    const salesOverTime = await sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) FILTER (WHERE paid = true) as paid_count,
        COUNT(*) as total_count
      FROM attendees
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    // 2. Ticket counts by type (for revenue calculation)
    const ticketsByType = await sql`
      SELECT 
        type as ticket_type,
        COUNT(*) FILTER (WHERE paid = true) as paid_count,
        COUNT(*) as total_count
      FROM attendees
      GROUP BY type
      ORDER BY paid_count DESC
    `;

    // 3. Overall stats
    const overallStats = await sql`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(*) FILTER (WHERE paid = true) as paid_tickets,
        COUNT(*) FILTER (WHERE sent = true) as sent_tickets,
        COUNT(*) FILTER (WHERE admitted_at IS NOT NULL) as admitted_count
      FROM attendees
    `;

    // 4. Payment method distribution
    const paymentMethods = await sql`
      SELECT 
        SPLIT_PART(payment_method, '@', 1) as method,
        COUNT(*) FILTER (WHERE paid = true) as paid_count,
        COUNT(*) as total_count
      FROM attendees
      GROUP BY SPLIT_PART(payment_method, '@', 1)
      ORDER BY paid_count DESC
    `;

    // 5. Recent activity (last 7 days hourly)
    const recentActivity = await sql`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as count
      FROM attendees
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour ASC
    `;

    let totalDiscountedCodes =
      await sql`SELECT COUNT(code) FROM rush_hour WHERE processed = TRUE`;

    // Calculate revenue by ticket type
    const revenueByType = ticketsByType.map((row) => ({
      ticketType: row.ticket_type,
      paidCount:
        parseInt(row.paid_count) +
        (row.ticket_type === "discounted"
          ? parseInt(totalDiscountedCodes[0].count)
          : 0),
      totalCount:
        parseInt(row.total_count) +
        (row.ticket_type === "discounted"
          ? parseInt(totalDiscountedCodes[0].count)
          : 0),
      revenue:
        (parseInt(row.paid_count) +
          (row.ticket_type === "discounted"
            ? parseInt(totalDiscountedCodes[0].count)
            : 0)) *
        (TICKET_PRICES[row.ticket_type] || 0),
    }));

    const totalRevenue = revenueByType.reduce((sum, r) => sum + r.revenue, 0);

    // Calculate conversion rate
    let stats = overallStats[0];
    stats.total_bookings =
      parseInt(stats.total_bookings) + parseInt(totalDiscountedCodes[0].count);
    stats.paid_tickets =
      parseInt(stats.paid_tickets) + parseInt(totalDiscountedCodes[0].count);
    stats.sent_tickets =
      parseInt(stats.sent_tickets) + parseInt(totalDiscountedCodes[0].count);
    const conversionRate =
      stats.total_bookings > 0
        ? Math.round((stats.paid_tickets / stats.total_bookings) * 100)
        : 0;

    return NextResponse.json({
      salesOverTime: salesOverTime.map((row) => ({
        date: row.date,
        paidCount: parseInt(row.paid_count),
        totalCount: parseInt(row.total_count),
      })),
      revenueByType,
      totalRevenue,
      overallStats: {
        totalBookings: parseInt(stats.total_bookings),
        paidTickets: parseInt(stats.paid_tickets),
        sentTickets: parseInt(stats.sent_tickets),
        admittedCount: parseInt(stats.admitted_count),
        conversionRate,
      },
      paymentMethods: paymentMethods.map((row) => ({
        method: row.method,
        paidCount: parseInt(row.paid_count),
        totalCount: parseInt(row.total_count),
      })),
      recentActivity: recentActivity.map((row) => ({
        hour: row.hour,
        count: parseInt(row.count),
      })),
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 },
    );
  }
}
