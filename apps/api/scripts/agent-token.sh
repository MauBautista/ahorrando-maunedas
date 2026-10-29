#!/usr/bin/env bash
# The home agent's token (T-201, 07 §5). Run it in your own terminal, not through the chat:
# the token is generated once into agent/.env (mode 600, outside git) and only its SHA-256 goes to the Worker.
#
#   apps/api/scripts/agent-token.sh dev|prod
set -euo pipefail

target=${1:?"uso: $0 dev|prod"}
case $target in
  dev) env_flag=(--env dev) ;;
  prod) env_flag=(--env '') ;;
  *) echo "entorno desconocido: $target (dev o prod)" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
envfile=$(cd "$here/../.." && pwd)/agent/.env
umask 077
touch "$envfile"
if ! grep -q '^AGENT_TOKEN=' "$envfile"; then
  # 64 random characters (07 §3).
  printf 'AGENT_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$envfile"
  echo "Se generó AGENT_TOKEN en agent/.env. Guárdalo también en tu gestor de contraseñas."
fi
token=$(grep -m1 '^AGENT_TOKEN=' "$envfile" | cut -d= -f2-)
printf '%s' "$token" | sha256sum | cut -d' ' -f1 |
  "$here/node_modules/.bin/wrangler" secret put AGENT_TOKEN_SHA256 "${env_flag[@]}" --config "$here/wrangler.jsonc"
echo "Listo: el Worker de $target guarda solo el hash del token."
