# hug app — interactive demo (static, sample data)

Embedded in the storefront's Rewards section (hug-theme `sections/hug-rewards.liquid`) via GitHub Pages.

This is the referral app's own **prototype mode** (sample people, scores and money; no server, nothing saved),
built from `hug-rewards-app` with `PROTO_WEB_ONLY=1 PROTO_WORK=<dir> bash scripts/proto-build.sh` and copied here
from `<dir>/tree/www`. Demo-only additions: `demo.css` (phone-frame overrides, built into `index.html`) and a storage
fallback at the top of `assets/proto-seed.js`.

To refresh: rebuild, then run `bash demo-refresh.sh <dir>/tree/www`. To change only `demo.css`: edit it, then paste it
into the `<style id="demo-css">` block in `index.html`, or refresh.

Do not link `demo.css` as a separate file. On a dropped connection it never arrived, and the phone lost its spacing:
logo under the island, home bar over the QR code.
