#!/usr/bin/env bash
# The home agent's token (T-201, 07 §5). Run it in your own terminal, not through the chat:
# the token is generated once into agent/.env (mode 600, outside git) and only its SHA-256 goes to the Worker.
# The first time, agent/.env starts from agent/.env.example; API_BASE always points at the chosen Worker (T-200).
#
#   apps/api/scripts/agent-token.sh dev|prod
set -euo pipefail

target=${1:?"uso: $0 dev|prod"}
case $target in
  dev) env_flag=(--env dev) base=https://maunedas-dev.maunedas.workers.dev ;;
  prod) env_flag=(--env '') base=https://maunedas.maunedas.workers.dev ;;
  *) echo "entorno desconocido: $target (dev o prod)" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
agentdir=$(cd "$here/../.." && pwd)/agent
envfile=$agentdir/.env
umask 077
[ -s "$envfile" ] || cp "$agentdir/.env.example" "$envfile"
chmod 600 "$envfile"
if ! grep -q '^AGENT_TOKEN=.' "$envfile"; then
  # 64 random characters (07 §3).
  new=$(openssl rand -hex 32)
  sed -i '/^AGENT_TOKEN=$/d' "$envfile"
  printf 'AGENT_TOKEN=%s\n' "$new" >> "$envfile"
  echo "Se generó AGENT_TOKEN en agent/.env. Guárdalo también en tu gestor de contraseñas."
fi
if grep -q '^API_BASE=' "$envfile"; then
  sed -i "s|^API_BASE=.*|API_BASE=$base|" "$envfile"
else
  printf 'API_BASE=%s\n' "$base" >> "$envfile"
fi
token=$(grep -m1 '^AGENT_TOKEN=' "$envfile" | cut -d= -f2-)
printf '%s' "$token" | sha256sum | cut -d' ' -f1 |
  "$here/node_modules/.bin/wrangler" secret put AGENT_TOKEN_SHA256 "${env_flag[@]}" --config "$here/wrangler.jsonc"
echo "Listo: el Worker de $target guarda solo el hash del token y el agente apunta a $base."
