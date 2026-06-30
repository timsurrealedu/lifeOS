#!/usr/bin/env bash
#
# Oracle A1 (Ampere ARM) auto-grabber. Retries `instance launch` until the free ARM capacity frees
# up, then stops. Built to run UNATTENDED on an always-on box (e.g. your Oracle trial box) so it keeps
# trying through the capacity windows your own devices are off for.
#
# On an OCI VM, set OCI_AUTH=instance_principal in the env file to auth with no API keys (needs a
# dynamic group + policy — see oracle-a1-retry.md). Set VAULT_DIR to get a success note in lifeOS.
#
# Setup, OCI CLI auth, and how to find every OCID: see deploy/oracle-a1-retry.md
#
# Quick start (after filling deploy/oracle-a1.env):
#   pm2 start deploy/oracle-a1-retry.sh --name a1-grabber --interpreter bash --no-autorestart
#   pm2 logs a1-grabber          # watch it
#   pm2 save                     # keep it across GCP reboots
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${A1_ENV:-$HERE/oracle-a1.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy oracle-a1.env.example and fill it in."; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${COMPARTMENT_OCID:?set it in $ENV_FILE}"
: "${SUBNET_OCID:?set it in $ENV_FILE}"
: "${IMAGE_OCID:?set it in $ENV_FILE}"
: "${SSH_PUBKEY_PATH:?set it in $ENV_FILE}"
: "${AVAILABILITY_DOMAINS:?set it in $ENV_FILE}"   # space-separated; one or many

SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCPUS:-2}"
MEM_GB="${MEM_GB:-12}"
NAME="${DISPLAY_NAME:-lifeos-a1}"
INTERVAL="${INTERVAL_SECONDS:-180}"           # wait between cycles on a plain "no capacity"
RATE_SLEEP="${RATE_SLEEP_SECONDS:-600}"       # longer wait after a "too many requests"
VAULT_DIR="${VAULT_DIR:-}"                     # optional: drop a success note here (surfaces in lifeOS)

# On an OCI VM, auth via instance principal (no API keys) when OCI_AUTH=instance_principal.
[ "${OCI_AUTH:-}" = "instance_principal" ] && export OCI_CLI_AUTH=instance_principal

command -v oci >/dev/null 2>&1 || { echo "oci CLI not found — install it first (see oracle-a1-retry.md)."; exit 1; }
PUBKEY="$(tr -d '\r\n' < "$SSH_PUBKEY_PATH")"
[ -n "$PUBKEY" ] || { echo "SSH_PUBKEY_PATH ($SSH_PUBKEY_PATH) is empty."; exit 1; }
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# On success, drop a capture into the synced vault inbox so it shows up in the lifeOS app + phone.
notify_vault() {
  [ -n "$VAULT_DIR" ] && [ -f "$VAULT_DIR/inbox.md" ] || return 0
  local line="- 🎉 Free Oracle A1 captured ($(ts))! Migrate lifeOS to it — see deploy/oracle-a1-retry.md step 6. #a1-captured"
  awk -v ins="$line" '1; /^## Unprocessed[[:space:]]*$/ && !d {print ""; print ins; d=1}' \
    "$VAULT_DIR/inbox.md" > "$VAULT_DIR/inbox.md.tmp" 2>/dev/null \
    && mv "$VAULT_DIR/inbox.md.tmp" "$VAULT_DIR/inbox.md" \
    && echo "[$(ts)] 📥 Dropped a note into the vault inbox — it'll sync to your phone."
}

echo "[$(ts)] A1 grabber started — $SHAPE ${OCPUS}OCPU/${MEM_GB}GB, ADs: $AVAILABILITY_DOMAINS, base interval ${INTERVAL}s"

attempt=0
while true; do
  attempt=$((attempt + 1))
  rate_limited=0
  for AD in $AVAILABILITY_DOMAINS; do
    echo "[$(ts)] attempt #$attempt — launching in $AD ..."
    out="$(oci compute instance launch \
      --availability-domain "$AD" \
      --compartment-id "$COMPARTMENT_OCID" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}" \
      --image-id "$IMAGE_OCID" \
      --subnet-id "$SUBNET_OCID" \
      --assign-public-ip true \
      --display-name "$NAME" \
      --metadata "{\"ssh_authorized_keys\":\"$PUBKEY\"}" 2>&1)"
    code=$?

    if [ $code -eq 0 ]; then
      echo "[$(ts)] 🎉 SUCCESS — instance is launching!"
      echo "$out" | tee "$HERE/a1-success.json"
      notify_vault
      echo "[$(ts)] Saved to $HERE/a1-success.json. Grabber stopping — go grab the public IP in the console."
      exit 0
    fi

    if echo "$out" | grep -qiE 'out of (host )?capacity|outofcapacity'; then
      echo "[$(ts)]   …no capacity in $AD yet."
    elif echo "$out" | grep -qiE 'too ?many ?requests|\b429\b|rate'; then
      echo "[$(ts)]   …rate limited; will back off."
      rate_limited=1
    elif echo "$out" | grep -qiE 'limitexceeded|service limit|quota|already exists'; then
      echo "[$(ts)] ⚠ Quota/limit hit — you may already hold an A1, or used your free A1 allotment. Stopping:"
      echo "$out" | head -8
      exit 2
    elif echo "$out" | grep -qiE 'notauthenticated|not authorized|authorization failed|signature|could not find config'; then
      echo "[$(ts)] ⚠ Auth/config error — fix the OCI CLI setup (see oracle-a1-retry.md). Stopping:"
      echo "$out" | head -8
      exit 3
    else
      echo "[$(ts)]   …other error:"; echo "$out" | head -4
    fi
  done

  if [ $rate_limited -eq 1 ]; then sleep_for=$RATE_SLEEP; else sleep_for=$INTERVAL; fi
  sleep_for=$(( sleep_for + RANDOM % 30 ))    # jitter so attempts aren't perfectly periodic
  echo "[$(ts)] sleeping ${sleep_for}s before next try..."
  sleep "$sleep_for"
done
