# Decisions

- No custom domain: the app is served at `<project>.web.app`.
- Licence: Unlicense.
- Categories: coupon, membership (which includes subscriptions), public transport, warranty,
  contract, insurance, paperwork (which replaced document expiry). There is no vehicle category.
- Freshness: pull before every write, plus every 60 seconds while the app is visible. Nothing else
  triggers a pull.
