/** Fetching a roster from another website, safely: https only, never to a private or local address
 * (checked when connecting, so DNS tricks can't get around it), redirects re-checked, size and
 * time limits. Error messages are user-facing (port of imported.fetch_text). */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { RosterSourceError } from "../../../shared/roster/imported";

export interface Fetcher {
  getText(url: string, what: string): Promise<string>;
}

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32]] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address); // IPv4-mapped IPv6
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, "ipv6");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that refuses private addresses. */
function guardedLookup(hostname: string, options: { all?: boolean }, cb: LookupCallback) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const ok = addresses.filter((a) => isPublicAddress(a.address));
    if (!ok.length || ok.length !== addresses.length) {
      return cb(Object.assign(new Error(`${hostname} is a private address`), { code: "EPRIVATE" }), "");
    }
    if (options.all) cb(null, ok);
    else cb(null, ok[0].address, ok[0].family);
  });
}

export function httpsFetcher({ maxBytes = 5_000_000, timeoutMs = 20_000, maxRedirects = 2,
  userAgent = "ACHAPhotoTools/1.0 (+roster import)" } = {}): Fetcher {
  const get = (url: URL, what: string, redirects: number): Promise<string> => new Promise((resolve, reject) => {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
      return reject(new RosterSourceError(`Couldn't reach ${what}: only https:// addresses on the normal port work`));
    }
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new RosterSourceError(`Couldn't reach ${what}. Check the address and that the site is online.`));
    }
    const req = request(url, {
      method: "GET",
      lookup: guardedLookup as never,
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= maxRedirects) return reject(new RosterSourceError(`${what} redirected too many times`));
        let next: URL;
        try {
          next = new URL(res.headers.location, url);
        } catch {
          return reject(new RosterSourceError(`${what} sent a broken redirect`));
        }
        return get(next, what, redirects + 1).then(resolve, reject);
      }
      if (status === 404) { res.resume(); return reject(new RosterSourceError(`${what} returned 404 (not found)`)); }
      if (status >= 400) { res.resume(); return reject(new RosterSourceError(`${what} returned HTTP ${status}`)); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new RosterSourceError(`${what} response is unexpectedly large`));
        } else chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", () => reject(new RosterSourceError(`Couldn't reach ${what}. Try again in a moment.`)));
    });
    // A whole-request deadline, not just an idle timeout.
    const deadline = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ETIMEDOUT") reject(new RosterSourceError(`${what} timed out. Try again in a moment.`));
      else reject(new RosterSourceError(`Couldn't reach ${what}. Check the address and that the site is online.`));
    });
    req.end();
  });

  return {
    getText: (url, what) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return Promise.reject(new RosterSourceError(`'${url}' isn't a valid website address`));
      }
      return get(parsed, what, 0);
    },
  };
}
