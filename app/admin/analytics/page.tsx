"use client";

import { getTicketTypeName, TicketType } from "@/app/ticket-types";
import { Ubuntu } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  TooltipValueType,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./analytics.module.css";

const ubuntu = Ubuntu({ weight: ["300", "400", "700"], subsets: ["latin"] });

// Color palette
const COLORS = [
  "#e11d48", // Red (TEDx)
  "#0ea5e9", // Blue
  "#10b981", // Green
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#84cc16", // Lime
];

interface AnalyticsData {
  salesOverTime: { date: string; paidCount: number; totalCount: number }[];
  revenueByType: {
    ticketType: string;
    paidCount: number;
    totalCount: number;
    revenue: number;
  }[];
  totalRevenue: number;
  overallStats: {
    totalBookings: number;
    paidTickets: number;
    sentTickets: number;
    admittedCount: number;
    conversionRate: number;
  };
  paymentMethods: { method: string; paidCount: number; totalCount: number }[];
}

function StatCard({
  title,
  value,
  subtitle,
  color = "#e11d48",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        padding: "24px",
        border: "1px solid #eee",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          color: "#888",
          marginBottom: "8px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 500,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#111" }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "6px" }}>
          {subtitle}
        </div>
      )}
      <div
        style={{
          width: "32px",
          height: "3px",
          background: color,
          marginTop: "16px",
          borderRadius: "2px",
        }}
      />
    </div>
  );
}

export default function AnalyticsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((res) => {
        if (res.status === 401) {
          router.push("/admin/login");
          return null;
        }
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        if (data) setData(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <section className={styles.dashboard} style={ubuntu.style}>
        <h1>Loading Analytics...</h1>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className={styles.dashboard} style={ubuntu.style}>
        <h1>Error Loading Analytics</h1>
        <p>{error}</p>
      </section>
    );
  }

  // Format sales data for chart
  const salesChartData = data.salesOverTime.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    }),
    Paid: d.paidCount,
    Bookings: d.totalCount,
  }));

  // Format revenue data for pie chart
  const revenueChartData = data.revenueByType
    .filter((d) => d.revenue > 0)
    .map((d) => ({
      name: getTicketTypeName(d.ticketType as TicketType),
      value: d.revenue,
      count: d.paidCount,
    }));

  return (
    <section className={styles.dashboard} style={ubuntu.style}>
      <div className={styles.dashboardInner}>
        <h1 style={{ marginBottom: "2rem", fontWeight: 600 }}>Analytics</h1>

        {/* Stats Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "2rem",
          }}
        >
          <StatCard
            title="Total Bookings"
            value={data.overallStats.totalBookings}
            color="#0ea5e9"
          />
          <StatCard
            title="Paid Tickets"
            value={data.overallStats.paidTickets}
            color="#10b981"
          />
          <StatCard
            title="Conversion Rate"
            value={`${data.overallStats.conversionRate}%`}
            subtitle={`${data.overallStats.paidTickets} of ${data.overallStats.totalBookings} bookings`}
            color="#f59e0b"
          />
          <StatCard
            title="Total Revenue"
            value={`EGP ${data.totalRevenue.toLocaleString()}`}
            color="#e11d48"
          />
          <StatCard
            title="Tickets Sent"
            value={data.overallStats.sentTickets}
            color="#8b5cf6"
          />
          <StatCard
            title="Admitted"
            value={data.overallStats.admittedCount}
            color="#06b6d4"
          />
        </div>

        {/* Charts Row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
            gap: "24px",
            marginBottom: "2rem",
          }}
        >
          {/* Sales Over Time */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "24px",
              border: "1px solid #eee",
            }}
          >
            <h3 style={{ marginBottom: "20px" }}>Sales Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={salesChartData}>
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Bookings"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Paid"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue by Type */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "24px",
              border: "1px solid #eee",
            }}
          >
            <h3 style={{ marginBottom: "20px" }}>Revenue by Type</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={revenueChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }) =>
                    `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {revenueChartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: TooltipValueType | undefined) =>
                    `EGP ${Number(value ?? 0).toLocaleString()}`
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "24px",
          }}
        >
          {/* Payment Methods */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "24px",
              border: "1px solid #eee",
            }}
          >
            <h3 style={{ marginBottom: "20px" }}>Payment Methods</h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {data.paymentMethods.map((pm, i) => {
                const percentage =
                  data.overallStats.paidTickets > 0
                    ? Math.round(
                        (pm.paidCount / data.overallStats.paidTickets) * 100,
                      )
                    : 0;
                return (
                  <div key={pm.method}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{pm.method}</span>
                      <span style={{ color: "#666" }}>
                        {pm.paidCount} ({percentage}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        background: "#eee",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${percentage}%`,
                          height: "100%",
                          background: COLORS[i % COLORS.length],
                          borderRadius: "4px",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ticket Type Breakdown */}
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "24px",
              border: "1px solid #eee",
            }}
          >
            <h3 style={{ marginBottom: "20px" }}>Ticket Types</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #eee" }}>
                  <th style={{ textAlign: "left", padding: "8px 0" }}>Type</th>
                  <th style={{ textAlign: "right", padding: "8px 0" }}>Paid</th>
                  <th style={{ textAlign: "right", padding: "8px 0" }}>
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.revenueByType.map((rt) => (
                  <tr
                    key={rt.ticketType}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td
                      style={{ padding: "8px 0", textTransform: "capitalize" }}
                    >
                      {getTicketTypeName(rt.ticketType as TicketType)}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px 0" }}>
                      {rt.paidCount}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        padding: "8px 0",
                        fontWeight: 600,
                      }}
                    >
                      EGP {rt.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
