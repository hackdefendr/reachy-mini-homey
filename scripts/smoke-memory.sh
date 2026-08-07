#!/usr/bin/env bash
#
# Smoke test for the Reachy Mini Controller /memory endpoints.
#
# Requires the app to be running with the memory changes (homey app run, or an
# installed build) and a Homey API key.
#
# Usage:
#   BASE="https://<homey-id>.connect.athom.com/api/app/co.hf.reachy" \
#   TOKEN="<your-Homey-API-key>" \
#   ./scripts/smoke-memory.sh
#
# BASE  - your Homey app URL (from the app's "Voice Control & Weather" setup
#         page, or your local homeylocal host). The cloud URL has a valid cert;
#         the local :4860 host is self-signed, so we pass -k either way.
# TOKEN - a Homey API key (my.homey.app -> Settings -> API Keys).

set -euo pipefail

BASE="${BASE:-}"
TOKEN="${TOKEN:-}"

if [ -z "$BASE" ] || [ -z "$TOKEN" ]; then
  echo "Set BASE and TOKEN, e.g.:" >&2
  echo "  BASE=\"https://<homey-id>.connect.athom.com/api/app/co.hf.reachy\" \\" >&2
  echo "  TOKEN=\"<your-Homey-API-key>\" $0" >&2
  exit 1
fi

BASE="${BASE%/}"
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# Pretty-print with jq when available, otherwise pass through.
J() { if command -v jq >/dev/null 2>&1; then jq .; else cat; fi; }
LEN() { if command -v jq >/dev/null 2>&1; then jq '.facts | length'; else cat; fi; }

echo "== forget (clean slate) =="
curl -sk -X DELETE "$BASE/memory" -H "$AUTH" | J

echo "== recall (expect empty preamble) =="
curl -sk "$BASE/memory" -H "$AUTH" | J

echo "== remember note 1 =="
curl -sk -X POST "$BASE/memory" -H "$AUTH" -H "$CT" \
  -d '{"text":"Jeff prefers warm lights at night"}' | J

echo "== remember note 2 =="
curl -sk -X POST "$BASE/memory" -H "$AUTH" -H "$CT" \
  -d '{"text":"Daughter'\''s recital is Friday at 7pm"}' | J

echo "== remember digest =="
curl -sk -X POST "$BASE/memory" -H "$AUTH" -H "$CT" \
  -d '{"text":"Been planning a Denver trip; likes warm lights; recital Friday.","kind":"digest"}' | J

echo "== recall (expect digest + both notes in .preamble) =="
curl -sk "$BASE/memory" -H "$AUTH" | J

echo "== stress: 30 notes (compaction should cap facts at 24) =="
for i in $(seq 1 30); do
  curl -sk -X POST "$BASE/memory" -H "$AUTH" -H "$CT" \
    -d "{\"text\":\"note number $i\"}" >/dev/null
done
echo -n "fact count after 30 inserts (expect 24): "
curl -sk "$BASE/memory" -H "$AUTH" | LEN

echo "== done =="
