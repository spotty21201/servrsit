/**
 * Target address validation for server registration (T-069, Tech Spec §6.2).
 *
 *  - Rejected outright: anything that is not a plain host name or IP literal
 *    (schemes, credentials, command text, shell syntax), unapproved ports,
 *    loopback, link-local, metadata endpoints, multicast and reserved ranges,
 *    the controller itself and operator addresses.
 *  - Private and CGNAT addresses are allowed only inside an enrolled route
 *    (for example the owner's Tailscale range), configured by the owner.
 *  - A host name is resolved and EVERY result must pass the same rules. The
 *    caller re-runs this before each connection (DNS rebinding).
 *
 * Every rejection reason is fixed text from this module. Input is never echoed.
 */

import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { isBlockedAddress } from "@servrsit/ssh";

export interface NetworkScope {
  /** Ports a server may be registered on. */
  readonly allowedPorts: readonly number[];
  /** CIDRs of routes the owner enrolled (private and CGNAT addresses must fall inside one). */
  readonly enrolledRoutes: readonly string[];
  /** Whether public internet addresses may be registered (Tech Spec §2: public routing is supported). */
  readonly allowPublicAddresses: boolean;
  /** Addresses of the owner's own devices and ServrSit's control plane, never registrable. */
  readonly operatorAddresses: readonly string[];
  /** The address ServrSit connects from; also never registrable. */
  readonly controllerAddress: string | null;
}

export type Resolver = (host: string) => Promise<readonly string[]>;

export type AddressCheck =
  | { readonly ok: true; readonly host: string; readonly port: number; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export const ADDRESS_REASONS = {
  malformed: "Enter a plain host name or IP address, without a scheme, user name, port or path.",
  port: "This port is not approved for ServrSit connections.",
  loopback: "Loopback and local-only addresses cannot be registered.",
  metadata: "Cloud metadata addresses cannot be registered.",
  reserved: "Link-local, multicast and reserved addresses cannot be registered.",
  controller: "This is ServrSit's own address.",
  operator: "This address belongs to the owner's devices or ServrSit's control plane.",
  privateOutsideRoute: "This private address is outside every route enrolled for ServrSit.",
  publicNotAllowed: "Public addresses are not enabled for this installation.",
  unresolved: "The name did not resolve.",
  resolvedBlocked: "The name resolves to an address that cannot be registered.",
} as const;

const HOST_LABELS = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT, used by Tailscale
PRIVATE.addSubnet("fc00::", 7, "ipv6"); // unique local

const RESERVED = new BlockList();
RESERVED.addSubnet("0.0.0.0", 8, "ipv4");
RESERVED.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
RESERVED.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
RESERVED.addSubnet("240.0.0.0", 4, "ipv4");
RESERVED.addSubnet("ff00::", 8, "ipv6"); // multicast
RESERVED.addSubnet("2001:db8::", 32, "ipv6"); // documentation
RESERVED.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 can reach IPv4 ranges indirectly

/** 169.254.169.254 (AWS, GCP, Azure), fd00:ec2::254 (AWS IPv6), 100.100.100.200 (Alibaba). */
const METADATA = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"]);

function family(ip: string): "ipv4" | "ipv6" {
  return isIP(ip) === 4 ? "ipv4" : "ipv6";
}

/** "::ffff:10.0.0.1" -> "10.0.0.1"; everything else unchanged, lower case. */
export function normaliseIp(ip: string): string {
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  return mapped?.[1] ?? lower;
}

function parseCidr(cidr: string): { network: string; prefix: number; type: "ipv4" | "ipv6" } {
  const [network, bits] = cidr.split("/");
  const prefix = Number(bits);
  if (network === undefined || isIP(network) === 0 || !Number.isInteger(prefix)) throw new Error(`invalid CIDR in enrolledRoutes: ${cidr}`);
  const type = family(network);
  if (prefix < 0 || prefix > (type === "ipv4" ? 32 : 128)) throw new Error(`invalid CIDR prefix in enrolledRoutes: ${cidr}`);
  return { network, prefix, type };
}

/** The controller's own interface addresses. */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) out.push(normaliseIp(entry.address));
  }
  return out;
}

export const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

export class AddressPolicy {
  private readonly enrolled = new BlockList();
  private readonly never: Set<string>;

  constructor(
    private readonly scope: NetworkScope,
    private readonly deps: { readonly resolver?: Resolver | undefined; readonly selfAddresses?: (() => readonly string[]) | undefined } = {},
  ) {
    for (const cidr of scope.enrolledRoutes) {
      const c = parseCidr(cidr);
      this.enrolled.addSubnet(c.network, c.prefix, c.type);
    }
    this.never = new Set(scope.operatorAddresses.map(normaliseIp));
  }

  get allowedPorts(): readonly number[] {
    return this.scope.allowedPorts;
  }

  /** Check one IP. Returns a fixed reason, or null when it may be contacted. */
  checkIp(raw: string): string | null {
    const ip = normaliseIp(raw);
    if (isIP(ip) === 0) return ADDRESS_REASONS.malformed;
    const type = family(ip);
    if (METADATA.has(ip)) return ADDRESS_REASONS.metadata;
    if (ip === "::1" || ip.startsWith("127.") || ip === "::") return ADDRESS_REASONS.loopback;
    if (isBlockedAddress(ip) || RESERVED.check(ip, type)) return ADDRESS_REASONS.reserved;
    const self = [...(this.deps.selfAddresses ?? localAddresses)(), ...(this.scope.controllerAddress === null ? [] : [this.scope.controllerAddress])];
    if (self.map(normaliseIp).includes(ip)) return ADDRESS_REASONS.controller;
    if (this.never.has(ip)) return ADDRESS_REASONS.operator;
    if (PRIVATE.check(ip, type)) return this.enrolled.check(ip, type) ? null : ADDRESS_REASONS.privateOutsideRoute;
    return this.scope.allowPublicAddresses ? null : ADDRESS_REASONS.publicNotAllowed;
  }

  /**
   * Validate an address and port as entered, then resolve it. Run again before
   * every connection: a name may resolve differently later.
   */
  async check(input: string, port: number): Promise<AddressCheck> {
    const host = parseHost(input);
    if (host === null) return { ok: false, reason: ADDRESS_REASONS.malformed };
    if (!Number.isInteger(port) || !this.scope.allowedPorts.includes(port)) return { ok: false, reason: ADDRESS_REASONS.port };
    if (isIP(host) !== 0) {
      const reason = this.checkIp(host);
      return reason === null ? { ok: true, host, port, addresses: [normaliseIp(host)] } : { ok: false, reason };
    }
    if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: ADDRESS_REASONS.loopback };
    let addresses: readonly string[];
    try {
      addresses = await (this.deps.resolver ?? systemResolver)(host);
    } catch {
      return { ok: false, reason: ADDRESS_REASONS.unresolved };
    }
    if (addresses.length === 0) return { ok: false, reason: ADDRESS_REASONS.unresolved };
    for (const a of addresses) {
      if (this.checkIp(a) !== null) return { ok: false, reason: ADDRESS_REASONS.resolvedBlocked };
    }
    return { ok: true, host, port, addresses: addresses.map(normaliseIp) };
  }
}

/**
 * A plain host name or IP literal, lower case, or null. "[v6]" is accepted
 * and unwrapped. Anything with a scheme, "@", "/", whitespace, quotes or a
 * port suffix is refused.
 */
export function parseHost(input: string): string | null {
  if (input.length === 0 || input.length > 253) return null;
  let host = input.trim() === input ? input.toLowerCase() : null;
  if (host === null) return null;
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
    return isIP(host) === 6 ? host : null;
  }
  if (isIP(host) !== 0) return host;
  if (host.startsWith("-") || host.endsWith(".")) return null;
  // Names that inet_aton would read as an address ("127.1", "0x7f000001") are refused.
  const numericLike = host.split(".").every((label) => /^(0x[0-9a-f]*|[0-9]+)$/.test(label));
  return HOST_LABELS.test(host) && !numericLike ? host : null;
}

/** For `from="..."` in authorized_keys: an IP literal or plain host name only. */
export function isSafeFromAddress(value: string): boolean {
  return isIP(value) !== 0 || (HOST_LABELS.test(value) && value.length <= 253);
}
