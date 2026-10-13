import React from 'react';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import { ApiError } from '@/lib/vectis-kit/api/client';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { ApiMap, RouteName } from '@/lib/vectis-kit/api/routes';

/** Props every mocked ReactECharts received, newest last. ECharts cannot paint in jsdom. */
export const chartCalls = { props: [] as Array<{ option: unknown; events?: Record<string, (e: unknown) => void> }> };

export const mockCharts = () => ({
  ReactECharts: (props: { option: unknown; events?: Record<string, (e: unknown) => void> }) => {
    chartCalls.props.push(props);
    return <div data-testid="echarts" />;
  },
});

export const lastChart = () => chartCalls.props[chartCalls.props.length - 1]!;
export const lastGraphChart = () => [...chartCalls.props].reverse().find((p) => (p.option as { series?: Array<{ type?: string }> }).series?.[0]?.type === 'graph')!;

type Override = { [K in RouteName]?: (body: ApiMap[K][0]) => ApiMap[K][1] | Promise<ApiMap[K][1]> };

/** The fixture API with some routes replaced, and every call recorded. */
export function testApi(overrides: Override = {}): SiemApi & { calls: Array<{ name: string; body: unknown }> } {
  const base = createFixtureApi(0);
  const calls: Array<{ name: string; body: unknown }> = [];
  return {
    mode: 'fixtures',
    calls,
    async call(name, input) {
      calls.push({ name, body: input?.body });
      const o = overrides[name as RouteName] as ((b: unknown) => unknown) | undefined;
      if (o) return (await o(input?.body)) as never;
      return base.call(name, input);
    },
  };
}

export const rejecting = (status: number, message: string, route: RouteName) => () => { throw new ApiError(status, message, route); };
