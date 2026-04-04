#!/bin/bash
while true; do
  echo "=== $(date) ==="
  echo "lynq.build A (GoDaddy):"
  dig @ns35.domaincontrol.com lynq.build A +short
  echo "www CNAME (GoDaddy):"
  dig @ns35.domaincontrol.com www.lynq.build CNAME +short
  echo "lynq.build A (Google):"
  dig @8.8.8.8 lynq.build A +short
  echo ""
  sleep 300
done
