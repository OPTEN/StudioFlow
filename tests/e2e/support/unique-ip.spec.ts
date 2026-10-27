import { afterEach, describe, expect, it } from 'vitest';
import { ADDRESSES_PER_WORKER, RUN_SLOTS, WORKERS_PER_RUN, ipAt, resetUniqueIpCounter, uniqueIp } from './unique-ip';

const OCTET = /^10\.(\d+)\.(\d+)\.(\d+)$/;

function expectValid(address: string): void {
  const match = OCTET.exec(address);
  expect(match, address).not.toBeNull();
  const [a, b, c] = match!.slice(1).map(Number) as [number, number, number];
  expect(a).toBeGreaterThanOrEqual(100);
  expect(a).toBeLessThanOrEqual(199);
  expect(b).toBeLessThanOrEqual(255);
  expect(c).toBeGreaterThanOrEqual(1);
  expect(c).toBeLessThanOrEqual(254);
}

describe('uniqueIp (#56)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetUniqueIpCounter();
  });

  it('never repeats within one worker, over its whole range', () => {
    process.env['TEST_WORKER_INDEX'] = '3';
    const seen = new Set<string>();
    for (let i = 0; i < ADDRESSES_PER_WORKER; i++) seen.add(uniqueIp());
    expect(seen.size).toBe(ADDRESSES_PER_WORKER);
  });

  it('throws instead of wrapping around when a worker is out of addresses', () => {
    for (let i = 0; i < ADDRESSES_PER_WORKER; i++) uniqueIp();
    expect(() => uniqueIp()).toThrow(RangeError);
  });

  it('gives different workers disjoint addresses', () => {
    const seen = new Set<string>();
    for (const worker of [0, 1, 2, 7, 63]) {
      process.env['TEST_WORKER_INDEX'] = String(worker);
      resetUniqueIpCounter();
      for (let i = 0; i < ADDRESSES_PER_WORKER; i++) seen.add(uniqueIp());
    }
    expect(seen.size).toBe(5 * ADDRESSES_PER_WORKER);
  });

  it('is injective over the full range and only makes valid octets', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < RUN_SLOTS; slot++)
      for (let worker = 0; worker < WORKERS_PER_RUN; worker++)
        for (const counter of [0, 1, 253, 254, 255, 8127]) {
          const address = ipAt(slot, worker, counter);
          expectValid(address);
          seen.add(address);
        }
    expect(seen.size).toBe(RUN_SLOTS * WORKERS_PER_RUN * 6);
    expect(ipAt(0, 0, 0)).toBe('10.100.0.1');
    expect(ipAt(RUN_SLOTS - 1, WORKERS_PER_RUN - 1, ADDRESSES_PER_WORKER - 1)).toBe('10.199.255.254');
  });

  it('moves runs with a different slot to other addresses', () => {
    expect(ipAt(0, 0, 0)).not.toBe(ipAt(1, 0, 0));
  });

  it('rejects out-of-range positions', () => {
    expect(() => ipAt(RUN_SLOTS, 0, 0)).toThrow(RangeError);
    expect(() => ipAt(0, WORKERS_PER_RUN, 0)).toThrow(RangeError);
    expect(() => ipAt(0, -1, 0)).toThrow(RangeError);
    expect(() => ipAt(0, 0, 0.5)).toThrow(RangeError);
  });
});
