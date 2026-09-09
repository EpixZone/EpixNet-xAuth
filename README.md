# xID

Decentralized identity and naming for EpixChain, served as an EpixNet xite.
Register human-readable names, manage profiles, configure DNS records and link
EpixNet identity addresses to a name, all on-chain.

This xite is also the channel hub: every linked identity publishes its channel
key bundle under `data/users/<name>.epix/` here, and the anonymous message pool
lives under `pool/`. Clients such as Epix Mail read from and write to the pool
through the node. See `docs/channels.md` in the EpixNet repository.

Address: `epix1xauthduuyn63k6kj54jzgp4l8nnjlhrsyaku8c`

## Features

### Name registration

- Register `name.epix` names from the UI
- Availability and fee shown as you type
- Length-based pricing, pulled from the chain's TLD config
- All registration fees are burned
- Names are permanent and do not expire

### Name management

- **My Names**: every name the wallet owns, ten per page
- **Primary name**: mark one name as the primary for reverse resolution
- **Transfer**: move a name to another address (irreversible)

### Search and resolution

- **Name search**: debounced lookup with owner and fee
- **Forward resolve**: name to owner (EVM and bech32), avatar and bio
- **Reverse resolve**: every name owned by a `0x...` or `epix1...` address
- **Identity reverse lookup**: the name linked to an EpixNet identity address

### Profiles

- Avatar URL and bio per name, stored on-chain through the xID precompile

### DNS records

- A, AAAA, NS, CNAME, MX, TXT, SRV and the EPIXNET record type (65280)
- TTL per record, add and delete through transactions

### Linked identities

- Link an EpixNet identity address to a name, with an optional label
- Revoke an identity; revoked entries stay visible with their block numbers
- The content root is computed from the active identities
- The node sends users here with `?linkIdentity=<address>&returnTo=/<xite>/`
  to link the identity it just minted. The page shows a three-step wizard
  (connect wallet, pick or register a name, link), polls the node until the
  identity resolves and then navigates back.

### Prices and stats

- Price tiers for every TLD and a fee calculator
- Total names, total fees burned and a per-TLD breakdown

## Wallets

Wallet discovery uses [epixkit](https://github.com/EpixZone/epixkit): every
installed EIP-6963 wallet shows up in the picker, and only installed ones. In
the EpixNet browser the built-in Epix Wallet is listed first. Reads go to the
node's configured EVM RPC list with failover. Writes are simulated against the
node first, so a revert reason is shown without the wallet ever opening.

## Layout

```
index.html            page shell, script order
content.json          xite manifest (also the hub's pool descriptor and include)
css/all.css           stylesheet on the Epix UI kit tokens (indigo accent)
img/                  logo and favicon
js/lib/               vendored libraries: maquette, epixframe, epixkit, ethers v6
js/utils/             Text, Bech32, Format, Rest and the shared xite helpers
js/wallet/            Chain, TxErrors, XidContract, TxState, Wallet
js/Icons.js           inline SVG icons
js/Layout.js          sidebar shell
js/pages/             one class per page
js/XidApp.js          the app: boot, routing, wrapper messages
data/users/           user content rules for the key bundles (signed include)
data-default/         template used when the xite is cloned
archive/react/        the previous React source, kept until the publish lands
```

Routes are query strings: `?` (Register), `?Search`, `?MyNames`,
`?Name/<tld>/<name>`, `?Prices`, `?Stats`, `?LinkIdentity`.

## Development

There is no build step. Add the folder as an owned xite on a node (or copy the
files into the xite's data directory) and reload. The wrapper supplies the
chain endpoints through `serverInfo`; a copy opened outside the wrapper falls
back to the public endpoints after two seconds.

Signing needs the owner key, which is not in this repository:

```
epix-server siteSign epix1xauthduuyn63k6kj54jzgp4l8nnjlhrsyaku8c <OWNER_PRIVATEKEY> --full
```

`content.json` carries the hub fields (`pool.channels`, `includes`,
`distribution`), so the first publish after this rewrite turns the xite into the
channel hub. `since_week` is the pool week of that publish.

## License

MIT
