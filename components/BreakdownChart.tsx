"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface ChartRow {
  name: string;
  amount: number;
}

function getRainbowColor(i: number, total: number): string {
  const hue = (i / Math.max(total, 1)) * 360;
  return `hsl(${hue}, 60%, 50%)`;
}

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

const rotationOffset = 120;

export function BreakdownChart({ data }: { data: ChartRow[] }) {
  const total = data.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="h-[400px] w-full rounded-lg border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            innerRadius={40}
            outerRadius={110}
            startAngle={rotationOffset}
            endAngle={-(360 - rotationOffset)}
            cx="50%"
            cy="44%"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={getRainbowColor(i, data.length)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, _name, props) => {
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
              return [`${formatInr(value)} (${pct}%)`, props.name];
            }}
          />
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            iconSize={10}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value: string) => (
              <span style={{ color: "#1e293b" }}> {value} </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
