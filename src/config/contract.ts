export const XID_ADDRESS = "0x0000000000000000000000000000000000000900" as const;

export const XID_ABI = [
  // Write functions
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferName",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateProfile",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "avatar", type: "string" },
      { name: "bio", type: "string" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setDNSRecord",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "recordType", type: "uint16" },
      { name: "value", type: "string" },
      { name: "ttl", type: "uint32" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deleteDNSRecord",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "recordType", type: "uint16" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setEpixNetPeer",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "peerAddress", type: "string" },
      { name: "label", type: "string" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeEpixNetPeer",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "peerAddress", type: "string" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPrimaryName",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  // Read functions
  {
    type: "function",
    name: "resolve",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reverseResolve",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reverseResolveBech32",
    inputs: [{ name: "bech32Addr", type: "string" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getProfile",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [
      { name: "avatar", type: "string" },
      { name: "bio", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDNSRecord",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "recordType", type: "uint16" },
    ],
    outputs: [
      { name: "value", type: "string" },
      { name: "ttl", type: "uint32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRegistrationFee",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEpixNetPeers",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [
      { name: "addresses", type: "string[]" },
      { name: "labels", type: "string[]" },
      { name: "addedAts", type: "uint64[]" },
      { name: "actives", type: "bool[]" },
      { name: "revokedAts", type: "uint64[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPrimaryName",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getContentRoot",
    inputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
    ],
    outputs: [
      { name: "root", type: "string" },
      { name: "updatedAt", type: "uint64" },
    ],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "NameRegistered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "NameTransferred",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProfileUpdated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DNSRecordSet",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
      { name: "recordType", type: "uint16", indexed: false },
      { name: "value", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DNSRecordDeleted",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
      { name: "recordType", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpixNetPeerSet",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
      { name: "peerAddress", type: "string", indexed: false },
      { name: "label", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpixNetPeerRevoked",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
      { name: "peerAddress", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PrimaryNameSet",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContentRootUpdated",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "tld", type: "string", indexed: false },
      { name: "root", type: "string", indexed: false },
    ],
  },
  {
    type: "function",
    name: "reverseResolveByPeer",
    inputs: [{ name: "peerAddress", type: "string" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "tld", type: "string" },
      { name: "found", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

export const DNS_RECORD_TYPES = [
  { type: 1, label: "A", placeholder: "93.184.216.34" },
  { type: 2, label: "NS", placeholder: "ns1.example.com" },
  { type: 5, label: "CNAME", placeholder: "alias.example.com" },
  { type: 15, label: "MX", placeholder: "10 mail.example.com" },
  { type: 16, label: "TXT", placeholder: "v=spf1 include:example.com ~all" },
  { type: 28, label: "AAAA", placeholder: "2606:2800:220:1:248:1893:25c8:1946" },
  { type: 33, label: "SRV", placeholder: "10 5 5060 sip.example.com" },
  { type: 65280, label: "EPIXNET", placeholder: "epix1dashuu6pvsut7aw9dx44f543mv7xt9zlydsj9t" },
] as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
