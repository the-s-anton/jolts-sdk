// Local demo only: Node does not consistently resolve .localhost hosts.
// Production SDK transport is unchanged and uses normal DNS.
const dns = require("node:dns");
const lookup = dns.lookup;
dns.lookup = (hostname, ...args) =>
  lookup(hostname.endsWith(".localhost") ? "127.0.0.1" : hostname, ...args);
