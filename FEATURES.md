# CIVIQ feature checklist (parity with nammakasa.in, audited 18 Nov 2026)

Legend: ✅ built · 🟡 built differently for Gurugram · ⛔ not built (reason given)

## Map and home
- ✅ Public map: ward boundaries, report pins, clusters, severity colours, green when cleared, yellow ring while a cleanup is under review
- ✅ Opens at your location ("Locating you on the map…") and pans to your area
- ✅ Counts: active / total reports; "N open in this area" list (nearest · oldest · most seen)
- ✅ Filters: severity (Minor, Moderate, Severe, Critical), status (Unresolved, Resolved), waste type, problem
- ✅ Search: places, wards, officials (councillors, MLAs, zone officers); press `/` to search
- ✅ City officials sheet: Commissioner + zone Joint Commissioners with open counts (🟡 MCG has 6 zones, GBA has 5 corporations)
- ✅ Ward leaderboard panel (totals, rate, worst 10 wards) → ward pages
- ✅ Communities directory + "Register your community" form (name, what you do, about, wards or whole city, links, logo with square crop, private contact), reviewed before going live; dot on the Communities button when a group is active in your ward
- ✅ Weekly digest banner + subscribe sheet (🟡 subscribers are stored; sending the Monday email needs an email service — not connected)
- ✅ What's new (changelog sheet; tap the version number)
- ✅ Follow menu (X, Instagram, Telegram — set handles in `data/officials.json`; hidden when empty)
- ✅ Language toggle: English ⇄ हिन्दी (🟡 Hindi instead of Kannada), remembered, auto-selected from the phone's language
- ✅ About sheet (why, how it works, stats, ways to help)
- ✅ Desktop: "Report from your phone" QR
- ✅ In-app browser warning (Instagram / Facebook / WhatsApp browsers can't share location)

## Reporting
- ✅ Camera-first, in-app camera at 1x (rear), with tips; falls back to the phone's camera app; no gallery uploads on phones
- ✅ Location sharpens in the background while you answer; "Location locked"; ward found automatically
- ✅ Steps: photo → how bad (4 sizes, compared to everyday things; different wording for fallen trees) → waste type → problem → landmark → check and submit (with Edit)
- ✅ Night-time photo warning
- ✅ Outside-MCG handling; location-denied help for Android / iPhone / computer
- ✅ Limit: 5 reports per device per day; duplicate within 50 m → adds your "seen"
- ✅ Thank-you screen with who's responsible and share options

## Report page
- ✅ Photo (tap for full screen), severity, status, ward, landmark, directions, "Seen by N people", I saw this too
- ✅ "What to do now" escalation ladder by age: helpline/WhatsApp → sanitary inspector → joint commissioner → commissioner → post publicly
- ✅ Know your ward: officers and elected representatives, tap to call / WhatsApp / email
- ✅ Share sheet: WhatsApp, Telegram, X, copy link
- ✅ Verify cleanup: within 100 m, live photo stamped with time, ward and coordinates → "Submitted for review" → turns green after approval; before/after "Cleaned up after N days"
- ✅ Not garbage?: within 100 m, live photo + reason (pothole, drainage, construction, streetlight, vehicle, other) → reviewed → removed
- ✅ Ward threshold crossed → pre-filled complaint to send on WhatsApp

## Ward, MLA, MP, zone pages
- ✅ `/ward/:n`, `/mla/:seat`, `/mp/gurgaon`, `/zone/:n`
- ✅ Open / cleared / typical days waiting / last report; call officer; share
- ✅ Every report as a photo grid, sort (newest, oldest, most seen) and filter (severity, unresolved/resolved)
- ✅ Insights: by size, how long open reports have waited, reported per week (12 weeks), repeat hot spots, worst wards (MLA/MP/zone)
- ✅ Elected representatives link to their pages; MP page lists its assembly seats with numbered markers
- ✅ "Not found" pages for bad links

## Analytics, data, admin
- ✅ Analytics: totals, streak, over time, clean-up speed, by zone, complaint type, waste type, most resolved / fastest / most unresolved wards, stale backlog, repeat hot spots, wards where citizens report most
- ✅ Methodology page
- ✅ Downloads behind an access passcode (CSV, GeoJSON)
- ✅ Review console (`/admin`): passcode + reviewer name and role; resolutions, disputes and community listings to approve or reject; distance from pin
- ✅ System status page (`/status`)
- ✅ About, contact, privacy, terms pages

## Not built
- ⛔ Auto-posting to X and Telegram alerts — need your API keys
- ⛔ Sending the weekly email — needs an email provider (subscribers are collected)
- ⛔ Donations (UPI/card) and the refund/shipping policy pages that go with them — need your payment account
- ⛔ Dynamic share images (OG images) — pages set text previews instead
- ⛔ Automatic spam/abuse screening of photos — reports are reviewable and flaggable instead
