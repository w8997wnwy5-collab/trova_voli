#!/usr/bin/env node
// Builds src/lib/data/airports.json and countries.json from public datasets:
//   - OurAirports airports.csv + countries.csv (public domain) https://github.com/davidmegginson/ourairports-data
//   - mwgg/Airports airports.json (MIT) for IANA time zones https://github.com/mwgg/Airports
// Usage: node scripts/build-airports.mjs <airports.csv> <countries.csv> <mwgg-airports.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [airportsCsv, countriesCsv, mwggJson] = process.argv.slice(2);
if (!airportsCsv || !countriesCsv || !mwggJson) {
  console.error('Usage: node scripts/build-airports.mjs <airports.csv> <countries.csv> <mwgg-airports.json>');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const mwgg = JSON.parse(readFileSync(mwggJson, 'utf8'));
const tzByIcao = new Map();
const tzByIata = new Map();
for (const a of Object.values(mwgg)) {
  if (!a.tz) continue;
  if (a.icao) tzByIcao.set(a.icao, a.tz);
  if (a.iata) tzByIata.set(a.iata, a.tz);
}

const countries = Object.fromEntries(
  parseCsv(readFileSync(countriesCsv, 'utf8')).map((c) => [c.code, c.name]),
);

const rank = { large_airport: 2, medium_airport: 1 };
const byIata = new Map();
for (const a of parseCsv(readFileSync(airportsCsv, 'utf8'))) {
  if (!(a.type in rank) || a.scheduled_service !== 'yes' || !/^[A-Z]{3}$/.test(a.iata_code)) continue;
  const tz = tzByIcao.get(a.icao_code) || tzByIcao.get(a.ident) || tzByIcao.get(a.gps_code) || tzByIata.get(a.iata_code);
  if (!tz) continue;
  const prev = byIata.get(a.iata_code);
  if (prev && rank[prev.type] >= rank[a.type]) continue;
  byIata.set(a.iata_code, { ...a, tz });
}

const round = (n) => Math.round(Number(n) * 10000) / 10000;
const airports = [...byIata.values()]
  .sort((x, y) => x.iata_code.localeCompare(y.iata_code))
  .map((a) => [
    a.iata_code,
    a.name.trim(),
    (a.municipality || '').trim(),
    a.iso_country,
    a.continent,
    round(a.latitude_deg),
    round(a.longitude_deg),
    a.tz,
    a.type === 'large_airport' ? 'L' : 'M',
  ]);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'data');
writeFileSync(path.join(outDir, 'airports.json'), JSON.stringify(airports).replace(/\],\[/g, '],\n['));
writeFileSync(path.join(outDir, 'countries.json'), JSON.stringify(countries, null, 0));
console.log(`airports: ${airports.length} (large: ${airports.filter((a) => a[8] === 'L').length}), countries: ${Object.keys(countries).length}`);
