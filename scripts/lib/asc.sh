#!/usr/bin/env bash
# Shared App Store Connect API helpers for local setup scripts.
# Same credential flags and JWT flow as Apple-Actions/download-provisioning-profiles.

set -euo pipefail

ASC_API_BASE="${ASC_API_BASE:-https://api.appstoreconnect.apple.com}"

asc_die() {
  echo "error: $*" >&2
  exit 1
}

asc_require_cmds() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || asc_die "Required command not found: $cmd"
  done
}

# Credential flags expected on every ASC script:
#   --issuer-id <id>
#   --api-key-id <id>
#   --api-private-key-path <path-to-AuthKey_*.p8>
# Calling scripts parse those into ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY_PATH,
# then call asc_load_credentials.
asc_load_credentials() {
  [[ -n "${ASC_ISSUER_ID:-}" ]] || asc_die "Missing required --issuer-id"
  [[ -n "${ASC_KEY_ID:-}" ]] || asc_die "Missing required --api-key-id"
  [[ -n "${ASC_PRIVATE_KEY_PATH:-}" ]] || asc_die "Missing required --api-private-key-path"
  [[ -f "$ASC_PRIVATE_KEY_PATH" ]] || asc_die "Private key file not found: $ASC_PRIVATE_KEY_PATH"

  ASC_PRIVATE_KEY_CONTENT="$(cat "$ASC_PRIVATE_KEY_PATH")"
  # Support keys pasted with literal \n sequences.
  ASC_PRIVATE_KEY_CONTENT="${ASC_PRIVATE_KEY_CONTENT//\\n/$'\n'}"
}

asc_make_jwt() {
  asc_require_cmds openssl python3

  local key_file
  key_file="$(mktemp)"
  printf '%s\n' "$ASC_PRIVATE_KEY_CONTENT" >"$key_file"

  ASC_TOKEN="$(
    ISSUER_ID="$ASC_ISSUER_ID" KEY_ID="$ASC_KEY_ID" KEY_FILE="$key_file" python3 - <<'PY'
import base64, json, os, subprocess, time

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def der_ecdsa_to_jose(der: bytes) -> bytes:
    # Convert OpenSSL DER ECDSA signature to JWT raw R||S (32+32).
    if der[0] != 0x30:
        raise ValueError("unexpected signature format")
    idx = 2
    if der[1] & 0x80:
        idx += der[1] & 0x7F
    if der[idx] != 0x02:
        raise ValueError("unexpected signature format")
    r_len = der[idx + 1]
    r = der[idx + 2 : idx + 2 + r_len]
    idx = idx + 2 + r_len
    if der[idx] != 0x02:
        raise ValueError("unexpected signature format")
    s_len = der[idx + 1]
    s = der[idx + 2 : idx + 2 + s_len]
    r = r.lstrip(b"\x00").rjust(32, b"\x00")[-32:]
    s = s.lstrip(b"\x00").rjust(32, b"\x00")[-32:]
    return r + s

issuer = os.environ["ISSUER_ID"]
key_id = os.environ["KEY_ID"]
key_file = os.environ["KEY_FILE"]
now = int(time.time())
header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
payload = {
    "iss": issuer,
    "iat": now,
    "exp": now + 12 * 60,
    "aud": "appstoreconnect-v1",
}
signing_input = (
    f"{b64url(json.dumps(header, separators=(',', ':')).encode())}."
    f"{b64url(json.dumps(payload, separators=(',', ':')).encode())}"
)
der_sig = subprocess.check_output(
    ["openssl", "dgst", "-sha256", "-sign", key_file],
    input=signing_input.encode(),
)
print(f"{signing_input}.{b64url(der_ecdsa_to_jose(der_sig))}")
PY
  )"
  rm -f "$key_file"
}

asc_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="$ASC_API_BASE$path"
  local http_code body_file

  [[ -n "${ASC_TOKEN:-}" ]] || asc_make_jwt

  body_file="$(mktemp)"

  # --globoff: ASC query params use filter[name]=...; curl otherwise treats [] as ranges.
  if [[ -n "$body" ]]; then
    http_code="$(
      curl -sS --globoff -X "$method" "$url" \
        -H "Authorization: Bearer $ASC_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$body" \
        -o "$body_file" \
        -w '%{http_code}'
    )"
  else
    http_code="$(
      curl -sS --globoff -X "$method" "$url" \
        -H "Authorization: Bearer $ASC_TOKEN" \
        -o "$body_file" \
        -w '%{http_code}'
    )"
  fi

  ASC_API_HTTP_CODE="$http_code"
  ASC_API_BODY="$(cat "$body_file")"
  rm -f "$body_file"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    if [[ "${ASC_API_ALLOW_FAILURE:-0}" -eq 1 ]]; then
      return 0
    fi
    echo "App Store Connect API $method $path failed (HTTP $http_code):" >&2
    echo "$ASC_API_BODY" >&2
    exit 1
  fi
}

asc_api_get() {
  asc_api GET "$1"
}

asc_api_post() {
  asc_api POST "$1" "$2"
}

asc_api_patch() {
  asc_api PATCH "$1" "$2"
}

asc_api_delete() {
  asc_api DELETE "$1"
}

asc_json_get() {
  local filter="$1"
  printf '%s' "$ASC_API_BODY" | jq -r "$filter"
}

asc_urlencode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$1"
}
