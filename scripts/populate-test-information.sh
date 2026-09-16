#!/usr/bin/env bash
# Populate TestFlight Test Information from the current app repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/asc.sh
source "$SCRIPT_DIR/lib/asc.sh"

APP_DIR="."
CONFIG_PATH=""
BUNDLE_ID=""
LOCALE=""
DESCRIPTION=""
FEEDBACK_EMAIL=""
MARKETING_URL=""
PRIVACY_POLICY_URL=""
APPLY=0
DRY_RUN=0
HELP=0

usage() {
  cat <<'EOF'
Populate TestFlight Test Information from the current app repo.

Reads bundle id, locale, Beta App Description, and feedback email from the
repo (config file, Expo app.json, Info.plist, package.json, README) and
creates or updates App Store Connect Test Information.

By default this prints what would be written and does not call Apple.
Pass --apply to send it to App Store Connect.

Usage:
  ./scripts/populate-test-information.sh --dir /path/to/your/app
  ./scripts/populate-test-information.sh --dir /path/to/your/app --apply \
    --issuer-id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \
    --api-key-id 'XXXXXXXXXX' \
    --api-private-key-path ~/Downloads/AuthKey_XXXXXXXXXX.p8

Options:
  --dir <path>                  App repo to scan (default: current directory)
  --config <path>               JSON config file (default: .apple-actions/test-information.json)
  --bundle-id <id>              Override bundle id
  --locale <locale>             Override locale (default: en-US)
  --description <text>          Override Beta App Description
  --feedback-email <email>      Override feedback email
  --marketing-url <url>         Optional marketing URL
  --privacy-policy-url <url>    Optional privacy policy URL
  --issuer-id <id>              App Store Connect issuer ID (required with --apply)
  --api-key-id <id>             App Store Connect API key ID (required with --apply)
  --api-private-key-path <p>    Path to AuthKey_*.p8 (required with --apply)
  --apply                       Write Test Information to App Store Connect
  --dry-run                     Same as default: print the payload and do not write
  -h, --help                    Show this help

Scripts need curl, jq, openssl, and python3. Local scripts take credentials as
CLI args; APPSTORE_* names are for GitHub Actions only.

Config file example (.apple-actions/test-information.json):
{
  "bundleId": "com.example.app",
  "locale": "en-US",
  "description": "Help us test the latest beta.",
  "feedbackEmail": "feedback@example.com"
}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) HELP=1; shift ;;
    --apply) APPLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --dir) APP_DIR="$2"; shift 2 ;;
    --config) CONFIG_PATH="$2"; shift 2 ;;
    --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    --feedback-email) FEEDBACK_EMAIL="$2"; shift 2 ;;
    --marketing-url) MARKETING_URL="$2"; shift 2 ;;
    --privacy-policy-url) PRIVACY_POLICY_URL="$2"; shift 2 ;;
    --issuer-id) ASC_ISSUER_ID="$2"; shift 2 ;;
    --api-key-id) ASC_KEY_ID="$2"; shift 2 ;;
    --api-private-key-path) ASC_PRIVATE_KEY_PATH="$2"; shift 2 ;;
    *) asc_die "Unknown argument: $1" ;;
  esac
done

if [[ "$HELP" -eq 1 ]]; then
  usage
  exit 0
fi

if [[ "$APPLY" -eq 1 && "$DRY_RUN" -eq 1 ]]; then
  asc_die "Pass either --apply or --dry-run, not both."
fi

asc_require_cmds python3
if [[ "$APPLY" -eq 1 ]]; then
  asc_require_cmds jq curl openssl
fi

discover_args=(
  python3 "$SCRIPT_DIR/lib/discover-test-information.py"
  --dir "$APP_DIR"
)
if [[ -n "$CONFIG_PATH" ]]; then
  discover_args+=(--config "$CONFIG_PATH")
fi
if [[ -n "$BUNDLE_ID" ]]; then
  discover_args+=(--bundle-id "$BUNDLE_ID")
fi
if [[ -n "$LOCALE" ]]; then
  discover_args+=(--locale "$LOCALE")
fi
if [[ -n "$DESCRIPTION" ]]; then
  discover_args+=(--description "$DESCRIPTION")
fi
if [[ -n "$FEEDBACK_EMAIL" ]]; then
  discover_args+=(--feedback-email "$FEEDBACK_EMAIL")
fi
if [[ -n "$MARKETING_URL" ]]; then
  discover_args+=(--marketing-url "$MARKETING_URL")
fi
if [[ -n "$PRIVACY_POLICY_URL" ]]; then
  discover_args+=(--privacy-policy-url "$PRIVACY_POLICY_URL")
fi

DISCOVERED="$("${discover_args[@]}")"

print_preview() {
  echo "Would write TestFlight Test Information:"
  printf '%s\n' "$DISCOVERED"
  echo
  echo "Preview only. Re-run with --apply --issuer-id ... --api-key-id ... --api-private-key-path ... to send this to App Store Connect."
}

if [[ "$APPLY" -eq 0 ]]; then
  print_preview
  exit 0
fi

asc_load_credentials

BUNDLE_ID="$(jq -r '.bundleId' <<<"$DISCOVERED")"
LOCALE="$(jq -r '.locale' <<<"$DISCOVERED")"
DESCRIPTION="$(jq -r '.description' <<<"$DISCOVERED")"
FEEDBACK_EMAIL="$(jq -r '.feedbackEmail' <<<"$DISCOVERED")"
MARKETING_URL="$(jq -r '.marketingUrl // empty' <<<"$DISCOVERED")"
PRIVACY_POLICY_URL="$(jq -r '.privacyPolicyUrl // empty' <<<"$DISCOVERED")"

ATTRIBUTES="$(
  jq -n \
    --arg description "${DESCRIPTION:0:4000}" \
    --arg feedbackEmail "$FEEDBACK_EMAIL" \
    --arg marketingUrl "$MARKETING_URL" \
    --arg privacyPolicyUrl "$PRIVACY_POLICY_URL" \
    '{
      description: $description,
      feedbackEmail: $feedbackEmail
    }
    + (if $marketingUrl != "" then {marketingUrl: $marketingUrl} else {} end)
    + (if $privacyPolicyUrl != "" then {privacyPolicyUrl: $privacyPolicyUrl} else {} end)'
)"

ENCODED_BUNDLE_ID="$(asc_urlencode "$BUNDLE_ID")"
asc_api_get "/v1/apps?filter[bundleId]=${ENCODED_BUNDLE_ID}"

APP_IDS="$(
  printf '%s' "$ASC_API_BODY" | jq -r \
    --arg bundleId "$BUNDLE_ID" \
    '[.data[]? | select(.attributes.bundleId == $bundleId) | .id] | .[]'
)"
APP_ID_COUNT="$(
  printf '%s' "$APP_IDS" | awk 'NF { n++ } END { print n+0 }'
)"
if [[ "$APP_ID_COUNT" -eq 0 ]]; then
  asc_die "Unable to find App Store Connect app for bundle id ${BUNDLE_ID}."
fi
if [[ "$APP_ID_COUNT" -gt 1 ]]; then
  asc_die "Multiple apps found for bundle id ${BUNDLE_ID}; please disambiguate."
fi
APP_ID="$(printf '%s' "$APP_IDS" | awk 'NF { print; exit }')"

find_localization_id() {
  asc_api_get "/v1/apps/${APP_ID}/betaAppLocalizations"
  printf '%s' "$ASC_API_BODY" | jq -r \
    --arg locale "$LOCALE" \
    '[.data[]? | select(.attributes.locale == $locale and .id != null) | .id] | .[0] // empty'
}

patch_localization() {
  local localization_id="$1"
  local body
  body="$(
    jq -n \
      --arg id "$localization_id" \
      --argjson attributes "$ATTRIBUTES" \
      '{
        data: {
          id: $id,
          type: "betaAppLocalizations",
          attributes: $attributes
        }
      }'
  )"
  asc_api_patch "/v1/betaAppLocalizations/${localization_id}" "$body"
}

EXISTING_ID="$(find_localization_id)"
if [[ -n "$EXISTING_ID" ]]; then
  patch_localization "$EXISTING_ID"
  echo "Test Information updated for ${BUNDLE_ID} (${LOCALE}) on app ${APP_ID}."
  exit 0
fi

POST_BODY="$(
  jq -n \
    --arg locale "$LOCALE" \
    --arg appId "$APP_ID" \
    --argjson attributes "$ATTRIBUTES" \
    '{
      data: {
        type: "betaAppLocalizations",
        attributes: ($attributes + {locale: $locale}),
        relationships: {
          app: {
            data: {
              type: "apps",
              id: $appId
            }
          }
        }
      }
    }'
)"

ASC_API_ALLOW_FAILURE=1 asc_api_post "/v1/betaAppLocalizations" "$POST_BODY"
if [[ "$ASC_API_HTTP_CODE" == "409" ]]; then
  EXISTING_ID="$(find_localization_id)"
  [[ -n "$EXISTING_ID" ]] || asc_die "Failed to create TestFlight Test Information (HTTP 409) and no localization appeared."
  patch_localization "$EXISTING_ID"
  echo "Test Information updated for ${BUNDLE_ID} (${LOCALE}) on app ${APP_ID}."
  exit 0
fi
if [[ "$ASC_API_HTTP_CODE" -lt 200 || "$ASC_API_HTTP_CODE" -ge 300 ]]; then
  echo "App Store Connect API POST /v1/betaAppLocalizations failed (HTTP $ASC_API_HTTP_CODE):" >&2
  echo "$ASC_API_BODY" >&2
  exit 1
fi

CREATED_ID="$(asc_json_get '.data.id // empty')"
[[ -n "$CREATED_ID" && "$CREATED_ID" != "null" ]] || \
  asc_die "Failed to create TestFlight Test Information: response did not include an id."
echo "Test Information created for ${BUNDLE_ID} (${LOCALE}) on app ${APP_ID}."
