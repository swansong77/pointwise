# PointWise Offers extension

Reads the offers page you have open and sends it to your own PointWise server; adds the offers you approved when you click **Enroll selected**. See `docs/offer-automation-extension.md` for the security model and the limits (selectors are text heuristics, unverified against the real sites).

Build: `bash extension-offers/build.sh`, then load `extension-offers/dist` as an unpacked extension.
