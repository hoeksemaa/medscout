#!/bin/bash
# Usage: ./test-api-key.sh YOUR_API_KEY
# Or:    ./test-api-key.sh   (reads from ../. env)

KEY="${1:-$(grep ANTHROPIC_API_KEY ../.env | head -1 | cut -d= -f2)}"

if [ -z "$KEY" ]; then
  echo "No API key provided. Usage: ./test-api-key.sh sk-ant-..."
  exit 1
fi

echo "Testing key: ${KEY:0:10}...${KEY: -4}"
echo ""

MODELS=(
  "claude-3-haiku-20240307"
  "claude-sonnet-4-5"
  "claude-sonnet-4-0"
  "claude-sonnet-4-6"
  "claude-opus-4-0"
  "claude-opus-4-6"
  "claude-3-7-sonnet-20250219"
  "claude-3-5-sonnet-20241022"
)

for MODEL in "${MODELS[@]}"; do
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    https://api.anthropic.com/v1/messages \
    -H "x-api-key: $KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "{\"model\":\"$MODEL\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    echo "  $MODEL -> 200 OK"
  else
    ERROR=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','unknown'))" 2>/dev/null || echo "$BODY")
    echo "  $MODEL -> $HTTP_CODE ($ERROR)"
  fi
done
