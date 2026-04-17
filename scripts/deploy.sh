#!/usr/bin/env bash
# Deploy tokexport to Vercel: link project, push env vars, deploy production.
#
# Reads specific vars from CompanyOS .env files (does NOT `source` them — that
# evaluates shell metacharacters and can leak secrets via error messages).
#
# Passes secrets via env vars (never as CLI flags) so they don't appear in
# argv and can't be echoed back by tool diagnostics. Filters stdout/stderr
# through a redactor as belt-and-suspenders.
#
# Usage:
#   ./scripts/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

read_env_var() {
  local file="$1"
  local var="$2"
  awk -F= -v key="$var" '
    $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
      exit
    }' "$file"
}

COMPANY_OS_ENV="$HOME/Corpus/Repositories/CompanyOS/.env"
COMPANY_OS_ENV_AI="$HOME/Corpus/Repositories/CompanyOS/.env.ai"

VERCEL_TOKEN=$(read_env_var "$COMPANY_OS_ENV" VERCEL_TOKEN)
STRIPE_API_KEY=$(read_env_var "$COMPANY_OS_ENV" STRIPE_API_KEY)
APIFY_API_KEY=$(read_env_var "$COMPANY_OS_ENV_AI" APIFY_API_KEY)
VERCEL_SCOPE="${VERCEL_SCOPE:-company-os-ed1425a9}"

[[ -n "$VERCEL_TOKEN" ]] || { echo "VERCEL_TOKEN missing"; exit 1; }
[[ -n "$STRIPE_API_KEY" ]] || { echo "STRIPE_API_KEY missing"; exit 1; }
[[ -n "$APIFY_API_KEY" ]] || { echo "APIFY_API_KEY missing"; exit 1; }

# Redactor: blanks known secrets from any output (defence-in-depth).
redact() {
  sed \
    -e "s|$VERCEL_TOKEN|<VERCEL_TOKEN_REDACTED>|g" \
    -e "s|$STRIPE_API_KEY|<STRIPE_API_KEY_REDACTED>|g" \
    -e "s|$APIFY_API_KEY|<APIFY_API_KEY_REDACTED>|g"
}

export VERCEL_TOKEN  # CLI picks it up; not passed as argv

run_vercel() {
  vercel "$@" --scope="$VERCEL_SCOPE" 2>&1 | redact
}

echo "→ Linking Vercel project (tokexport)..."
run_vercel link --yes --project=tokexport

push_env() {
  local name="$1"
  local value="$2"
  run_vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf "%s" "$value" | run_vercel env add "$name" production >/dev/null
  echo "  ✓ $name"
}

echo "→ Pushing server secrets..."
# CompanyOS .env stores Stripe key as STRIPE_API_KEY but lib/stripe.ts reads
# STRIPE_SECRET_KEY (Stripe's canonical name). Bridge here.
push_env STRIPE_SECRET_KEY "$STRIPE_API_KEY"
push_env APIFY_API_KEY "$APIFY_API_KEY"

echo "→ Pushing public vars..."
push_env NEXT_PUBLIC_PRODUCT_NAME       "TokExport"
push_env NEXT_PUBLIC_PRODUCT_TAGLINE    "Full data export for any TikTok creator. \$1."
push_env NEXT_PUBLIC_INPUT_LABEL        "TikTok handle"
push_env NEXT_PUBLIC_INPUT_PLACEHOLDER  "@mrbeast"
push_env NEXT_PUBLIC_BUY_BUTTON_TEXT    "Buy for \$1"
push_env NEXT_PUBLIC_STRIPE_PAYMENT_LINK "https://buy.stripe.com/test_14A14o3rb92P4tx9aRbbG00"

echo "→ Deploying to production..."
run_vercel --prod --yes
