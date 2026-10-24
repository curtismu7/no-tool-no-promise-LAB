#!/usr/bin/env bash
# Deploy the MOCK-ONLY hosted build to the SE cluster. The first deploy of this app is OWNER-APPROVED: this script refuses
# to run unless OWNER_APPROVED=1 is set by the owner. It never builds or pushes an image; it applies manifests for an
# image that already exists in the registry, and it is not run by any test.
#
# The manifests carry only the literal tokens __IMAGE__ and __SE_HOST__ (no namespace field). This script validates the
# values, renders the tokens with sed, fails if any __TOKEN__ is left, and passes -n "$NAMESPACE" to kubectl.
# --dry-run only renders and checks: it needs no kubectl and never contacts a cluster.
#
#   OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/<repo>/no-tool-no-promise:<tag> SE_HOST=<host> k8s/deploy.sh [--dry-run]
#
# After the deploy (not done by this script): verify by CONTENT, not 200 (GET /api/health must say mode "se-mock"), check
# the registry manifest and the pod's imageID match IMAGE, then browser-test the page and hand over the full https:// URL.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "refusing: $1" >&2; exit 2; }
[ "${OWNER_APPROVED:-}" = "1" ] || die "the first SE deploy of this app is owner-approved (set OWNER_APPROVED=1)"
: "${IMAGE:?set IMAGE to the registry image with an explicit tag}" "${SE_HOST:?set SE_HOST to the SE cluster host}" "${NAMESPACE:?set NAMESPACE explicitly (no default; the SE namespace is an owner decision)}"

# Validate every value BEFORE rendering. The allowed sets contain no '|' (the sed delimiter), '&', backslash or newline.
case "$IMAGE" in
  ""|*[!A-Za-z0-9._:/@-]*) die "IMAGE has characters outside A-Za-z0-9._:/@-";;
  *:latest|*:HEAD|*:) die "IMAGE must carry an explicit immutable tag or digest, not latest/HEAD";;
esac
# A colon before the last '/' is a registry port (registry:5000/x), not a tag: the last path segment must carry the tag or digest.
case "${IMAGE##*/}" in
  *:*|*@*) ;;
  *) die "IMAGE has no tag or digest in its last path segment (a colon before the last '/' is a registry port, not a tag)";;
esac
case "$SE_HOST" in ""|*[!a-z0-9.-]*) die "SE_HOST must be a plain host name";; esac
[[ "$NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$ ]] || die "NAMESPACE must be a DNS label (lowercase letters, digits, '-', max 63)"

FILES="deployment.yaml service.yaml ingress.yaml"
render() { sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" "$1"; echo '---'; }
rendered="$(for f in $FILES; do render "$f"; done)"
if left="$(printf '%s\n' "$rendered" | grep -nE '__[A-Z0-9_]+__')"; then
  echo "refusing: unreplaced placeholder token(s) in the rendered manifests:" >&2; printf '%s\n' "$left" >&2; exit 3
fi

if [ "${1:-}" = "--dry-run" ]; then echo "# dry run: namespace=$NAMESPACE (passed as -n to kubectl, not baked into manifests); no cluster contacted"; printf '%s\n' "$rendered"; exit 0; fi
for f in $FILES; do render "$f" | kubectl apply -n "$NAMESPACE" -f -; done
kubectl rollout status -n "$NAMESPACE" deployment/no-tool-no-promise --timeout=120s
