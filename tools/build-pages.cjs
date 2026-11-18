// Generates the static info pages in public/ (about, contact, privacy, terms, methodology).
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public');
const page = (file, title, desc, body, extra = '') => fs.writeFileSync(path.join(OUT, file), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0e3b2e">
  <title>${title} | CIVIQ</title>
  <meta name="description" content="${desc}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/styles.css" rel="stylesheet">
</head>
<body>
<div class="page">
  <header class="page-head"><a href="/" aria-label="CIVIQ home"><img src="/logo.svg" alt="CIVIQ" class="logo"></a>
    <nav aria-label="Pages"><a href="/">Map</a><a href="/analytics">Data</a><a href="/wards">Wards</a><a href="/downloads">Open data</a></nav></header>
${body}
</div>
<footer class="site"><a href="/about">About</a><a href="/methodology">Methodology</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a><a href="/status">Status</a></footer>
${extra}
</body>
</html>
`);

page('about.html', 'About', 'CIVIQ is a public map of Gurugram garbage and the officials responsible for clearing it.', `
  <h1>A public map of Gurugram's garbage, and who must clear it.</h1>
  <div class="prose">
  <p>Garbage gets cleared faster when it is clear whose job it is, and when everyone can see how long it has waited. CIVIQ makes both visible.</p>
  <div class="explainer"><video src="/video/civiq-explainer.mp4" poster="/video/civiq-explainer.jpg" controls playsinline preload="none" aria-label="How CIVIQ works"></video></div>
  <h2>How it works</h2>
  <ol><li><b>Report.</b> Photograph a garbage spot from the spot. Your location is detected automatically.</li>
  <li><b>Tag who is responsible.</b> The report is linked to its MCG ward, councillor, zone sanitary inspector, Joint Commissioner, MLA and MP.</li>
  <li><b>Keep it visible.</b> Neighbours confirm it. It stays on the public map until someone standing at the spot photographs it clean, and a reviewer approves the photo.</li></ol>
  <h2>Who is behind it</h2>
  <p>CIVIQ is a citizen project. It is not run by, or affiliated with, the Municipal Corporation of Gurugram (MCG) or any political party. Officials' names and contact details come from MCG's public website.</p>
  <h2>Ways to help</h2>
  <ul><li>Report spots you see, and tap "I saw this too" on reports near you.</li><li>Verify cleanups when a spot near you is cleared.</li>
  <li>Join or register a <a href="/communities">volunteer community</a>.</li><li>Share CIVIQ with your RWA.</li></ul>
  <p>No ads. No sign-up. Free for everyone.</p>
  </div>`);

page('contact.html', 'Contact', 'Contact the CIVIQ team.', `
  <h1>Contact</h1>
  <div class="prose">
  <p id="mail">Loading…</p>
  <h2>Work at MCG?</h2><p>Ward-level reports and data are available to MCG staff. Reviewers can sign in to the <a href="/admin">review console</a> with a passcode from the CIVIQ team.</p>
  <h2>To complain about garbage directly</h2><p>Call the MCG citizen helpline <a href="tel:18001801817">1800-180-1817</a>, or report it on the <a href="/">map</a> so it stays visible until it is cleared.</p>
  </div>`, `<script type="module">
import { api } from '/common.js';
const c = await api('/api/config'); const e = c.officials.contact_email;
document.getElementById('mail').innerHTML = e ? 'Feedback, bugs, data requests or press: <a href="mailto:' + e + '">' + e + '</a>' : 'A contact email has not been set up yet.';
</script>`);

page('privacy.html', 'Privacy', 'What CIVIQ collects and why.', `
  <h1>Privacy</h1>
  <div class="prose">
  <p><b>Reports are anonymous.</b> We do not ask for your name, phone or email to report garbage.</p>
  <h2>What we store when you report</h2>
  <ul><li>The photo you take, the exact location of the spot, the time, and the answers you choose (problem, size, waste type, landmark). All of this is public on the map.</li>
  <li>A random device ID kept in your browser, so we can stop duplicate "I saw this too" taps and limit spam to 5 reports per day. It is never shown publicly or included in data downloads.</li></ul>
  <h2>Verifying a cleanup or saying "Not garbage?"</h2>
  <p>We store the photo and its location to check you were within 100 m of the spot. The photo carries a strip with the time, ward and coordinates so reviewers can see when and where it was taken. Reviewers sign their decisions with their name.</p>
  <h2>Weekly digest and communities</h2>
  <p>If you subscribe to the digest we store your email and the name you give, only to send the digest. If you register a community, your contact name and phone are seen only by the CIVIQ team to verify the listing.</p>
  <h2>Services we use</h2>
  <p>Map tiles come from CARTO and OpenStreetMap, place names from OpenStreetMap's Nominatim, fonts from Google Fonts and code libraries from unpkg and cdnjs. These services receive your IP address when your browser loads them. We do not use advertising or tracking cookies.</p>
  <h2>Removal</h2><p>To remove a report that shows a person, a vehicle number or anything private, use "Not garbage?" on the report, or contact us.</p>
  </div>`);

page('terms.html', 'Terms', 'Terms for using CIVIQ.', `
  <h1>Terms</h1>
  <div class="prose">
  <ol><li>Report only real garbage spots, from the spot, with a photo you take there.</li>
  <li>Do not photograph people's faces, vehicle number plates or private property interiors. Reports showing them may be removed.</li>
  <li>Reports, photos and locations you submit are published on the public map and in open data, under the Creative Commons Attribution 4.0 licence.</li>
  <li>Official names and contact details are taken from public MCG sources and may be out of date. Ward boundaries on the map are approximate.</li>
  <li>CIVIQ is provided as is, without any guarantee that a report will be acted on. It is not an official MCG complaint channel; for urgent issues call the MCG helpline 1800-180-1817.</li>
  <li>We may remove reports that are not garbage, are abusive, or break these terms.</li></ol>
  </div>`);

page('methodology.html', 'Methodology', 'How CIVIQ counts reports, resolutions, hot spots and streaks.', `
  <h1>How the numbers are counted</h1>
  <div class="prose">
  <h2>Reports</h2><p>One report is one garbage spot photographed on the spot. A second report within 50 m of an open report is not counted again; it is added as a "seen" confirmation on the first one. Reports removed after a "Not garbage?" review are left out of every number.</p>
  <h2>Resolved</h2><p>A report counts as resolved only after someone within 100 m of the spot submits a live photo and a reviewer approves it. The resolution time is the time between the report and that photo.</p>
  <h2>Resolution rate</h2><p>Resolved reports divided by total reports.</p>
  <h2>Days waiting</h2><p>For an area page, the typical (median) age of its open reports.</p>
  <h2>Hot spots</h2><p>Places where two or more reports were filed within 50 m of each other.</p>
  <h2>Streak</h2><p>The number of days in a row, ending today, on which at least one report was resolved.</p>
  <h2>Wards</h2><p>MCG has 36 wards (2025). MCG publishes which localities each ward contains but not a boundary map, so ward edges here are drawn from those official locality lists using OpenStreetMap, inside MCG's outer limit. Spots near a ward edge can land in the neighbouring ward. Assembly constituencies use the official 2008 delimitation map.</p>
  <h2>Officials</h2><p>Councillors, zone Joint Commissioners, Senior Sanitary Inspectors and Executive Engineers come from mcg.gov.in. Sanitary inspector and engineer offices are numbered I–VI; we match them to zones I–VI by number.</p>
  <h2>Photos of representatives</h2><p>MLA photos: PRS Legislative Research (prsindia.org), CC BY 4.0. Mayor and Commissioner: Municipal Corporation of Gurugram (mcg.gov.in). MP: Planning Commission, via Wikimedia Commons (GODL-India). Councillors and zone officers are shown with initials because no official photos are published.</p>
  </div>`);
console.log('pages written');
