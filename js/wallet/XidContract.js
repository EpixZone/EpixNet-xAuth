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
    { type: 65280, label: "EPIXNET", title: "EpixNet xite (recommended)", field: "Xite address or URL", placeholder: "epix1... or your full EpixNet xite URL", help: "Point your name to a published xite. EpixNet uses this address when someone opens your name.", example: "Copy the epix1... xite address from its URL in EpixNet, or paste the full URL here." },
    { type: 1, label: "A", title: "A · IPv4 address", field: "IPv4 address", placeholder: "93.184.216.34", help: "Store the IPv4 address of a web server.", example: "Example: 93.184.216.34" },
    { type: 28, label: "AAAA", title: "AAAA · IPv6 address", field: "IPv6 address", placeholder: "2001:db8::1", help: "Store the IPv6 address of a web server.", example: "Example: 2001:db8::1" },
    { type: 5, label: "CNAME", title: "CNAME · Hostname alias", field: "Target hostname", placeholder: "www.example.com", help: "Store another hostname as the target for this name.", example: "Enter a hostname, without https:// or a page path." },
    { type: 16, label: "TXT", title: "TXT · Text or verification", field: "Text value", placeholder: "site-verification=your-code", help: "Store text such as a verification code or service policy.", example: "Paste the exact value your service provides. The service must support reading xID records." },
    { type: 15, label: "MX", title: "MX · Mail server", field: "Priority and mail hostname", placeholder: "10 mail.example.com", help: "Store a mail server hostname with its delivery priority. Lower numbers have higher priority.", example: "Example: 10 mail.example.com. This does not create an email account or configure Epix Mail." },
    { type: 2, label: "NS", title: "NS · Name server", field: "Name server hostname", placeholder: "ns1.example.com", help: "Store the hostname of a name server.", example: "Example: ns1.example.com. Saving this does not delegate the name in public DNS." },
    { type: 33, label: "SRV", title: "SRV · Service endpoint", field: "Priority, weight, port, and hostname", placeholder: "10 5 5060 sip.example.com", help: "Store a service location with priority, weight, port, and hostname.", example: "Example: 10 5 5060 sip.example.com. Use values supplied by your service." }
  ];

  window.XidContract = {
    ADDRESS: ADDRESS,
    ZERO: ZERO,
    ABI: ABI,
    DNS_RECORD_TYPES: DNS_RECORD_TYPES,
    iface: null,

    recordInfo: function (type) {
      return DNS_RECORD_TYPES.find(function (r) { return r.type === Number(type); }) || DNS_RECORD_TYPES[0];
    },

    // Accept the address or a copied local/gateway URL, but store only the
    // xite address that EpixNet's resolver expects in an EPIXNET record.
    xiteAddress: function (input) {
      var value = String(input || "").trim();
      if (Bech32.isBech32Address(value)) return value;
      try {
        var url = new URL(value, "http://localhost");
        if (!/^(https?|epix):$/.test(url.protocol)) return null;
        // The native browser uses https://<address>.epix/; epix:// links
        // and raw-address hosts also identify the xite in the hostname.
        var host = url.hostname.toLowerCase();
        var addressHost = host.endsWith(".epix") ? host.slice(0, -5) : host;
        if (Bech32.isBech32Address(addressHost)) return addressHost;
        // A native xite host must not be replaced by an address-shaped
        // page path. Only ordinary HTTP gateways use the first path part.
        if (url.protocol === "epix:" || host.endsWith(".epix") || (host.indexOf("epix1") === 0 && host.indexOf(".") === -1)) return null;
        var part = decodeURIComponent(url.pathname).split("/").filter(Boolean)[0];
        return Bech32.isBech32Address(part) ? part : null;
      } catch (e) { return null; }
    },

    recordValue: function (type, input) {
      var value = Number(type) === 16 ? String(input || "") : String(input || "").trim();
      var error = "";
      if (Number(type) === 65280) {
        value = this.xiteAddress(value) || "";
        if (!value) error = "Enter a valid epix1... xite address or paste its EpixNet URL.";
      } else if (!value.trim()) error = "Enter a value for this record.";
      else if (Number(type) === 1 && !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) error = "Enter four IPv4 numbers separated by dots, such as 93.184.216.34.";
      else if (Number(type) === 1 && value.split(".").some(function (n) { return Number(n) > 255; })) error = "Each IPv4 number must be between 0 and 255.";
      else if (Number(type) === 28) {
        try { if (value.indexOf(":") === -1) throw new Error(); new URL("http://[" + value + "]/"); }
        catch (e) { error = "Enter a valid IPv6 address, such as 2001:db8::1."; }
      }
      if (new TextEncoder().encode(value).length > 1024) error = "Record values can contain up to 1,024 bytes.";
      return { value: value, error: error };
    },

    recordTtlError: function (value) {
      var ttl = Number(value);
      return !String(value).trim() || !Number.isInteger(ttl) || (ttl !== 0 && (ttl < 60 || ttl > 604800))
        ? "Use 0 for the default, or 60 to 604800 seconds (7 days)." : "";
    },

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
      if (!Wallet.address || Wallet.address.toLowerCase() !== String(from).toLowerCase()) {
        throw new Error("Your wallet changed. Review the details and try again.");
      }
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
