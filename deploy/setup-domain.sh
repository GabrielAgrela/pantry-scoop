#!/usr/bin/env bash
# Publishes Pantry Scoop at https://$DOMAIN through the host's nginx + Let's Encrypt,
# the same way the other gabruel.xyz projects are set up. Safe to re-run.
set -euo pipefail

DOMAIN="${1:-pantry.gabruel.xyz}"
SITE="${DOMAIN//./_}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="$HERE/nginx/$DOMAIN.conf"
PUBLIC_IP="$(curl -s -4 --max-time 5 https://ifconfig.me || true)"

echo "1/5 DNS: $DOMAIN must point to this server ($PUBLIC_IP)"
# Ask the domain's own nameserver: public resolvers may still cache an earlier "no such name".
NAMESERVER="$(dig +short NS "${DOMAIN#*.}" | head -1)"
RESOLVED="$(dig +short "$DOMAIN" A "@${NAMESERVER:-1.1.1.1}" | tail -1)"
if [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "   $DOMAIN resolves to '${RESOLVED:-nothing}'. Add an A record (Host: ${DOMAIN%%.*}, Value: $PUBLIC_IP) and re-run."
  exit 1
fi

echo "2/5 Certificate"
if ! sudo test -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  sudo mkdir -p /var/www/certbot
  # Temporary HTTP-only site so Let's Encrypt can reach the challenge.
  printf 'server {\n  listen 80;\n  server_name %s;\n  location /.well-known/acme-challenge/ { root /var/www/certbot; default_type text/plain; }\n  location / { return 404; }\n}\n' "$DOMAIN" \
    | sudo tee "/etc/nginx/sites-available/$SITE" >/dev/null
  sudo ln -sf "../sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
  sudo nginx -t && sudo systemctl reload nginx
  sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring
fi

echo "3/5 Nginx site"
sudo cp "$CONF" "/etc/nginx/sites-available/$SITE"
sudo ln -sf "../sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
sudo nginx -t && sudo systemctl reload nginx

echo "4/5 Local name (this machine can't always reach its own public IP)"
grep -qE "^127\.0\.0\.1\s+$DOMAIN\$" /etc/hosts || echo "127.0.0.1 $DOMAIN" | sudo tee -a /etc/hosts >/dev/null

sleep 2
echo "5/5 Check"
curl -sS -o /dev/null -w "   https://$DOMAIN -> %{http_code}\n" "https://$DOMAIN/api/auth/config"
