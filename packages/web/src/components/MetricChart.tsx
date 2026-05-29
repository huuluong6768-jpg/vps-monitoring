'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
  formatter?: (v: number) => string;
}

interface Props {
  data: ReadonlyArray<unknown>;
  series: SeriesConfig[];
  yFormatter?: (v: number) => string;
  domain?: [number | 'auto', number | 'auto'];
  height?: number;
}

export function MetricChart({ data, series, yFormatter, domain, height = 220 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data as ReadonlyArray<Record<string, unknown>> as unknown as Array<Record<string, unknown>>}
        margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="rgb(var(--chart-grid) / 1)" strokeDasharray="3 6" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(v) => format(new Date(v), 'HH:mm')}
          stroke="rgb(var(--chart-axis) / 1)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          stroke="rgb(var(--chart-axis) / 1)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={yFormatter}
          domain={domain ?? [0, 'auto']}
        />
        <Tooltip
          contentStyle={{
            background: 'rgb(var(--chart-tooltip-bg) / 1)',
            border: '1px solid rgb(var(--chart-tooltip-border) / 1)',
            borderRadius: 12,
            padding: '8px 12px',
            fontSize: 12,
            color: 'rgb(var(--chart-tooltip-fg) / 1)',
          }}
          labelFormatter={(v) => format(new Date(v as string), 'PP HH:mm:ss')}
          formatter={(value, name) => {
            const s = series.find((x) => x.label === name || x.key === name);
            const formatted = s?.formatter ? s.formatter(Number(value)) : value;
            return [formatted, s?.label ?? name];
          }}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#g-${s.key})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
