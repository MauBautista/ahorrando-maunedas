#!/usr/bin/env bash
# Creates the first admin of an environment (02 §5.4). Run it in your own terminal, not through the chat:
# the password is typed here and the one-time BOOTSTRAP_TOKEN is generated, used and deleted here.
#
#   apps/api/scripts/bootstrap.sh dev <usuario> "<Nombre visible>" [correo-de-google]
set -euo pipefail

target=${1:?"uso: $0 dev|prod <usuario> \"<Nombre visible>\" [correo-de-google]"}
username=${2:?falta el usuario}
display_name=${3:?falta el nombre visible}
google_email=${4:-}

case $target in
  dev) env_flag=(--env dev); host=https://maunedas-dev.maunedas.workers.dev ;;
  prod) env_flag=(--env ''); host=https://maunedas.maunedas.workers.dev ;;
  *) echo "entorno desconocido: $target (dev o prod)" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
wrangler=("$here/node_modules/.bin/wrangler")
config=(--config "$here/wrangler.jsonc")

read -rsp "Contraseña para $username (mínimo 8 caracteres): " password; echo
read -rsp "Repítela: " again; echo
[[ "$password" == "$again" ]] || { echo "No coinciden." >&2; exit 1; }
(( ${#password} >= 8 )) || { echo "Debe tener al menos 8 caracteres." >&2; exit 1; }

token=$(openssl rand -hex 32)
cleanup() {
  echo "Borrando BOOTSTRAP_TOKEN de $target…"
  "${wrangler[@]}" secret delete BOOTSTRAP_TOKEN "${env_flag[@]}" "${config[@]}" || echo "Bórralo a mano: wrangler secret delete BOOTSTRAP_TOKEN ${env_flag[*]}" >&2
}
printf '%s' "$token" | "${wrangler[@]}" secret put BOOTSTRAP_TOKEN "${env_flag[@]}" "${config[@]}" >/dev/null
trap cleanup EXIT
echo "Token cargado; esperando a que llegue al Worker…"
sleep 10

# Body and token go through stdin and a file descriptor, so neither appears in the process list.
body=$(USERNAME="$username" DISPLAY_NAME="$display_name" PASSWORD="$password" GOOGLE_EMAIL="$google_email" python3 -I -c '
import json, os
body = {"username": os.environ["USERNAME"], "display_name": os.environ["DISPLAY_NAME"], "password": os.environ["PASSWORD"]}
if os.environ["GOOGLE_EMAIL"]:
    body["google_email"] = os.environ["GOOGLE_EMAIL"]
print(json.dumps(body))')
status=$(printf '%s' "$body" | curl -sS -o /tmp/bootstrap-$$.json -w '%{http_code}' -X POST "$host/v1/bootstrap" \
  -H @<(printf 'X-Bootstrap-Token: %s\n' "$token") -H 'Content-Type: application/json' --data-binary @-)
unset password again body
echo "HTTP $status"
python3 -I -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), ensure_ascii=False, indent=2))' /tmp/bootstrap-$$.json
rm -f /tmp/bootstrap-$$.json
