/** Helpers for the output IP restriction editor (spec 4.8: IP addresses or CIDR ranges, IPv4 and IPv6). */

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;

/** True for a dotted IPv4 address (no leading zeros). */
export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => IPV4_OCTET.test(part));
}

/** True for an IPv6 address in standard notation (with at most one `::`, optionally ending in an IPv4 address). */
export function isIpv6(value: string): boolean {
  if (!value.includes(':') || value.split('::').length > 2) {
    return false;
  }
  let groups = value.split(':');
  let budget = 8;
  const last = groups[groups.length - 1];
  if (last.includes('.')) {
    if (!isIpv4(last)) {
      return false;
    }
    groups = groups.slice(0, -1);
    budget = 6;
  }
  if (value.includes('::')) {
    const [head, tail] = value.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':').filter((group) => !group.includes('.')) : [];
    const all = [...headGroups, ...tailGroups];
    return all.length < budget && all.every((group) => IPV6_GROUP.test(group));
  }
  return groups.length === budget && groups.every((group) => IPV6_GROUP.test(group));
}

/** True for an IPv4/IPv6 address or a CIDR range such as `10.0.0.0/24` or `fd00::/64`. */
export function isIpOrCidr(raw: string): boolean {
  const value = raw.trim();
  if (!value) {
    return false;
  }
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0) {
    return false;
  }
  const v4 = isIpv4(address);
  const v6 = !v4 && isIpv6(address);
  if (!v4 && !v6) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  return bits >= 0 && bits <= (v4 ? 32 : 128);
}

/** Normalised form for comparisons and storage (trimmed, IPv6 lower case). */
export function normalizeIp(raw: string): string {
  const value = raw.trim();
  return value.includes(':') ? value.toLowerCase() : value;
}
