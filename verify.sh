#!/usr/bin/env bash
# CBC — done predicates. This starts RED: an empty scaffold must fail.
# Never weaken a check to make it pass. Phase checks are the only phase gate;
# the independent fresh-context review runs once after the final phase.
set -uo pipefail
cd "$(dirname "$0")"

FILTER="${1:-}"
pass=0
fail=0

check() {
  local tag="$1" desc="$2"; shift 2
  if [ -n "$FILTER" ] && [ "$FILTER" != "$tag" ]; then return 0; fi
  if "$@" >/dev/null 2>&1; then
    printf '  PASS  [%s] %s\n' "$tag" "$desc"
    pass=$((pass + 1))
  else
    printf '  FAIL  [%s] %s\n' "$tag" "$desc"
    fail=$((fail + 1))
  fi
}

checksh() {
  local tag="$1" desc="$2" command="$3"
  check "$tag" "$desc" sh -c "$command"
}

echo "== CBC verify =="

check phase-0 "architecture contract exists" sh -c 'test -f spec.md && rg -q "StyleProof|Garment|Prava|Linq|CommerceQuote" spec.md'
check phase-0 "typed test and package scaffolding exists" sh -c 'test -f package.json && test -d tests && test -d src'

check phase-1 "sanitized wardrobe integration spike is recorded" sh -c 'test -f reports/closet-integration-spike.md && rg -q "STATUS: PASS" reports/closet-integration-spike.md && rg -q "Linq" reports/closet-integration-spike.md && rg -q "OpenAI" reports/closet-integration-spike.md && rg -q "Prava" reports/closet-integration-spike.md && rg -q "UCP" reports/closet-integration-spike.md'
check phase-1 "wardrobe, render, apparel, and fallback evidence exist" sh -c 'test -f reports/closet-integration-spike.md && rg -q "STATUS: PASS" reports/closet-integration-spike.md && rg -qi "wardrobe|garment" reports/closet-integration-spike.md && rg -qi "render|photo" reports/closet-integration-spike.md && rg -qi "apparel|clothing" reports/closet-integration-spike.md && rg -qi "pinned|sandbox" reports/closet-integration-spike.md'

check phase-2 "domain tests pass" npm test
check phase-2 "style decisions and terminal states are implemented" sh -c 'test -d src && rg -q "MORE_EVIDENCE" src && rg -q "STYLE_READY" src && rg -q "GAP_FOUND" src && rg -q "SANDBOX_COMPLETED" src && rg -q "ORDER_COMPLETED" src'
check phase-2 "retention, proof, and gap modules exist" sh -c 'test -d src && rg -q "delete|retention" src && rg -q "StyleProof|Style Proof" src && rg -q "gap" src'

check phase-3 "commerce and payment contracts are tested" npm test
check phase-3 "fixed apparel, pinned, and sandbox paths are explicit" sh -c 'test -d src && rg -qi "apparel|UCP|PINNED_DEMO|SANDBOX" src'
check phase-3 "idempotency and safe errors are implemented" sh -c 'test -d src && rg -qi "idempot|safe.?error|duplicate|timeout" src'

check phase-4 "brand and exactly three UI proposals exist" sh -c 'test -f brand/BRAND-TRUTH.md && test -f brand/ART-DIRECTION.md && test -d proposals && test "$(find proposals -maxdepth 1 -type f -name "*.html" | wc -l | tr -d " ")" -eq 3'
check phase-4 "proof UI and Linq routes build" sh -c 'test -d app && test -f app/proof/[token]/page.tsx && test -f app/api/webhooks/linq/route.ts && npm run build'

check phase-5 "full tests pass" npm test
check phase-5 "production build passes" npm run build
check phase-5 "README and demo disclosure exist" sh -c 'test -f README.md && test -f DEMO_SCRIPT.md && rg -qi "sandbox" README.md DEMO_SCRIPT.md && rg -qi "Style Proof|checkout handoff" README.md DEMO_SCRIPT.md'
checksh phase-5 "source tree exists and has no committed secrets or raw-photo fixtures" 'test -d src && ! rg -n --hidden -g "!*.map" "(BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{16,}|[0-9]{13,19}|CVV|test.card|wardrobe.*\.(png|jpg|jpeg))" src app reports tests'

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
cat <<'MANUAL'

manual:
  [ ] Brand winner and frontend direction were explicitly selected by the user.
  [ ] Clean deployed Linq photo journey works for STYLE_READY and GAP_FOUND.
  [ ] Raw photos were deleted after extraction/rendering and the preview is labelled editorial.
  [ ] Live UCP handoff, sandbox receipt, and any real order are visibly distinguished.
  [ ] Production checkout, public posts, and external submissions were authorized before execution.
MANUAL

[ "$fail" -eq 0 ]
