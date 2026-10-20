# hug app — interactive demo (static, sample data)

Embedded in the storefront's Rewards section (hug-theme `sections/hug-rewards.liquid`) via GitHub Pages.

This is the referral app's own **prototype mode** (sample people, scores and money; no server, nothing saved),
built from `hug-rewards-app` with `PROTO_WEB_ONLY=1 PROTO_WORK=<dir> bash scripts/proto-build.sh` and copied here
from `<dir>/tree/www`. Demo-only additions: `demo.css` (phone-frame overrides) and a storage fallback at the top of
`assets/proto-seed.js`. To refresh: rebuild, copy `www/` over everything except `.nojekyll`, `netlify.toml`,
`README.md` and `demo.css`, then re-apply the `demo.css` link in `index.html` and the storage fallback.
