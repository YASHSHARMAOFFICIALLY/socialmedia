"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

// Example campaign: likes per day over two weeks. Placeholder data, not a customer's.
const data = [
  { day: "1 Nov", likes: 96 },
  { day: "2 Nov", likes: 112 },
  { day: "3 Nov", likes: 104 },
  { day: "4 Nov", likes: 138 },
  { day: "5 Nov", likes: 171 },
  { day: "6 Nov", likes: 158 },
  { day: "7 Nov", likes: 149 },
  { day: "8 Nov", likes: 182 },
  { day: "9 Nov", likes: 214 },
  { day: "10 Nov", likes: 196 },
  { day: "11 Nov", likes: 167 },
  { day: "12 Nov", likes: 178 },
  { day: "13 Nov", likes: 162 },
  { day: "14 Nov", likes: 157 },
];

const config = {
  likes: { label: "Likes", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CampaignChart() {
  return (
    <ChartContainer config={config} className="aspect-auto h-44 w-full">
      <AreaChart data={data} margin={{ left: 16, right: 16, top: 8 }}>
        <defs>
          <linearGradient id="campaign-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-likes)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-likes)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={3}
          fontSize={12}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="likes"
          type="monotone"
          stroke="var(--color-likes)"
          strokeWidth={2}
          fill="url(#campaign-fill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
