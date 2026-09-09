// The xID precompile: reads through the node's RPC, writes through the
// connected wallet after an eth_call pre-flight against the node (wallets
// proxy eth_call and may swallow revert data; the node returns the clean
// Error(string) reason). A failed simulation never reaches the wallet.
(function () {
  var ADDRESS = "0x0000000000000000000000000000000000000900";
  var ZERO = "0x0000000000000000000000000000000000000000";
  var ABI = [
    "function register(string name, string tld) returns (bool success)",
    "function transferName(string name, string tld, address newOwner) returns (bool success)",
    "function updateProfile(string name, string tld, string avatar, string bio) returns (bool success)",
    "function setDNSRecord(string name, string tld, uint16 recordType, string value, uint32 ttl) returns (bool success)",
    "function deleteDNSRecord(string name, string tld, uint16 recordType) returns (bool success)",
    "function linkIdentity(string name, string tld, string identityAddress, string label) returns (bool success)",
    "function unlinkIdentity(string name, string tld, string identityAddress) returns (bool success)",
    "function setPrimaryName(string name, string tld) returns (bool success)",
    "function resolve(string name, string tld) view returns (address owner)",
    "function reverseResolve(address addr) view returns (string name, string tld)",
    "function reverseResolveBech32(string bech32Addr) view returns (string name, string tld)",
    "function reverseResolveByIdentity(string identityAddress) view returns (string name, string tld, bool found)",
    "function getProfile(string name, string tld) view returns (string avatar, string bio)",
    "function getDNSRecord(string name, string tld, uint16 recordType) view returns (string value, uint32 ttl)",
    "function getRegistrationFee(string name, string tld) view returns (uint256 fee)",
    "function getLinkedIdentities(string name, string tld) view returns (string[] addresses, string[] labels, uint64[] addedAts, bool[] actives, uint64[] revokedAts, int64[] revokedAtTimes)",
    "function getPrimaryName(address owner) view returns (string name, string tld)",
    "function getContentRoot(string name, string tld) view returns (string root, uint64 updatedAt)",
    "event NameRegistered(address indexed owner, string name, string tld)",
    "event NameTransferred(address indexed from, address indexed to, string name, string tld)",
    "event ProfileUpdated(address indexed owner, string name, string tld)",
    "event DNSRecordSet(string name, string tld, uint16 recordType, string value)",
    "event DNSRecordDeleted(string name, string tld, uint16 recordType)",
    "event IdentityLinked(string name, string tld, string identityAddress, string label)",
    "event IdentityUnlinked(string name, string tld, string identityAddress)",
    "event PrimaryNameSet(address indexed owner, string name, string tld)",
    "event ContentRootUpdated(string name, string tld, string root)"
  ];

  var DNS_RECORD_TYPES = [
    { type: 1, label: "A", placeholder: "93.184.216.34" },
    { type: 2, label: "NS", placeholder: "ns1.example.com" },
    { type: 5, label: "CNAME", placeholder: "alias.example.com" },
    { type: 15, label: "MX", placeholder: "10 mail.example.com" },
    { type: 16, label: "TXT", placeholder: "v=spf1 include:example.com ~all" },
    { type: 28, label: "AAAA", placeholder: "2606:2800:220:1:248:1893:25c8:1946" },
    { type: 33, label: "SRV", placeholder: "10 5 5060 sip.example.com" },
    { type: 65280, label: "EPIXNET", placeholder: "epix1dashuu6pvsut7aw9dx44f543mv7xt9zlydsj9t" }
  ];

  window.XidContract = {
    ADDRESS: ADDRESS,
    ZERO: ZERO,
    ABI: ABI,
    DNS_RECORD_TYPES: DNS_RECORD_TYPES,
    iface: null,

    interface: function () {
      if (!this.iface) this.iface = new ethers.Interface(ABI);
      return this.iface;
    },

    // A view call through the node, with endpoint failover. Returns the raw
    // ethers Result (index into it, or read named outputs).
    read: function (fn, args) {
      return Chain.withRpc(function (provider) {
        var contract = new ethers.Contract(ADDRESS, ABI, provider);
        return contract[fn].apply(contract, args || []);
      });
    },

    // getLinkedIdentities' six parallel arrays -> one object per identity.
    peersFrom: function (result) {
      var out = [];
      if (!result || !result[0]) return out;
      for (var i = 0; i < result[0].length; i++) {
        out.push({
          address: result[0][i],
          label: result[1][i],
          addedAt: result[2][i],
          active: result[3][i],
          revokedAt: result[4][i],
          revokedAtTime: result[5][i]
        });
      }
      return out;
    },

    // Simulate against the node, then send through the wallet and wait for
    // the receipt. `onStatus(status, hash?)` is called at every transition.
    write: async function (fn, args, onStatus) {
      var notify = onStatus || function () {};
      var data = this.interface().encodeFunctionData(fn, args || []);
      var from = Wallet.address;
      notify("simulating");
      await Chain.withRpc(function (provider) {
        return provider.call({ from: from, to: ADDRESS, data: data });
      });
      notify("pending");
      var signer = await Wallet.signer();
      var contract = new ethers.Contract(ADDRESS, ABI, signer);
      var tx = await contract[fn].apply(contract, args || []);
      notify("confirming", tx.hash);
      var receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Transaction failed");
      notify("success", tx.hash);
      return receipt;
    },

    recordLabel: function (type) {
      for (var i = 0; i < DNS_RECORD_TYPES.length; i++) {
        if (DNS_RECORD_TYPES[i].type === type) return DNS_RECORD_TYPES[i].label;
      }
      return String(type);
    },

    recordPlaceholder: function (type) {
      for (var i = 0; i < DNS_RECORD_TYPES.length; i++) {
        if (DNS_RECORD_TYPES[i].type === type) return DNS_RECORD_TYPES[i].placeholder;
      }
      return "Value";
    }
  };
})();
