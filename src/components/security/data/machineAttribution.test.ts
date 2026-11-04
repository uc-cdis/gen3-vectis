import { describe, expect, it } from 'vitest';
import { hostNameForAddress, machineSessionsLink } from './machineAttribution';
import { readDeepLink, readLinkIndex } from '../hunt/huntModel';

describe('a machine, from its address', () => {
  it.each([
    ['10.128.4.44', 'ip-10-128-4-44'],
    ['192.168.0.7', 'ip-192-168-0-7'],
    ['172.16.9.1', 'ip-172-16-9-1'],
    ['172.31.255.254', 'ip-172-31-255-254'],
  ])('%s is %s', (address, host) => expect(hostNameForAddress(address)).toBe(host));

  it.each(['198.51.100.7', '8.8.8.8', '172.32.0.1', '10.0.0.256', '10.0.0', '', null, undefined, 5, 'ip-10-0-0-1', '10.0.0.1; drop'])(
    'is nothing for %s: only a private IPv4 names one of our machines',
    (address) => expect(hostNameForAddress(address)).toBeNull(),
  );
});

describe('who was on this machine', () => {
  const row = { src_ip: '10.128.4.44', event_time: '2026-11-02T03:00:00Z' };

  it('opens the session summaries for that machine, ending at the event and starting twelve hours before', () => {
    const link = machineSessionsLink(row)!;
    expect(readLinkIndex(link)).toBe('process_activity');
    const parsed = readDeepLink(link);
    expect(parsed.range).toEqual({ start: '2026-11-01T15:00:00.000Z', end: '2026-11-02T03:01:00.000Z' });
    expect(parsed.filters).toEqual([
      { field: 'activity', op: 'eq', value: 'ssm_session' },
      { field: 'hostname', op: 'eq', value: 'ip-10-128-4-44' },
    ]);
  });

  it.each([
    { src_ip: '198.51.100.7', event_time: '2026-11-02T03:00:00Z' },
    { src_ip: '10.128.4.44' },
    { src_ip: '10.128.4.44', event_time: 'yesterday' },
    {},
  ])('is no link without a private machine and a readable time (%j)', (r) => expect(machineSessionsLink(r)).toBeNull());
});
