# Site design

Two pages, one stylesheet (`styles.css`) and one helper module (`ui.mjs`):

- `index.html`, the landing page: navigation, hero with a live vault card, how it works, who can't change it, live proof numbers, questions, closing call to action.
- `app.html`, the app: labelled sidebar and five views (Overview, Heirs & payouts, Activity, Proofs, Verify yourself), routed by the URL hash.

Look: one dark theme. Violet light sits behind frosted glass panels (`backdrop-filter`, a soft top-lit gradient and a 1px inner highlight). Buttons are a violet gloss. Mint, red and amber only ever mean verified, refused or failed, and waiting. Inter for text, JetBrains Mono for hashes and addresses. The visual direction started from the Dribbble shot "DeFi Investment Dashboard" by Alamin Hossen. Nothing was copied from it.

Data rule: every figure comes from public RPC at load time through `verify.mjs`. Avatars are identicons generated from real account names. The activity chart plots the real gas each recorded transaction burned.
