#!/usr/bin/env bash

# Configure optional provider fallback credentials without putting secrets in
# command arguments. User-scoped keys should normally be added through the UI.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${1:-"$script_dir/../.env"}"
anthropic_key=''
openrouter_key=''
aws_access_key=''
aws_secret_key=''

if (( $# > 1 )); then
    printf 'usage: %s [environment-file]\n' "$0" >&2
    exit 2
fi

read_secret() {
    local prompt="$1"
    local destination="$2"
    local value

    printf '%s' "$prompt" >&2
    IFS= read -r -s value
    printf '\n' >&2
    printf -v "$destination" '%s' "$value"
}

read_secret 'Enter your Anthropic API key (sk-ant-...): ' anthropic_key
read_secret 'Enter your OpenRouter API key (sk-or-...): ' openrouter_key
read_secret 'Enter your AWS Access Key ID: ' aws_access_key
read_secret 'Enter your AWS Secret Access Key: ' aws_secret_key

printf '%s\n' \
    "$anthropic_key" \
    "$openrouter_key" \
    "$aws_access_key" \
    "$aws_secret_key" |
    node "$script_dir/update-provider-env.mjs" "$env_file"

unset anthropic_key openrouter_key aws_access_key aws_secret_key

printf '\nProvider fallback credentials updated in %s.\n' "$env_file"
printf 'The file is owner-readable only; do not commit or share it.\n\n'
printf 'Pricing Summary:\n'
printf '===============\n\n'
printf 'Haiku models: FREE for all users (100%% subsidized)\n'
printf '%s\n' "Sonnet models: ~83% subsidized (\$0.50/\$2.50 vs \$3/\$15)"
printf '%s\n' "Opus models: 80% subsidized (\$3/\$15 vs \$15/\$75)"
printf 'GPT-3.5: FREE for all users\n'
printf '%s\n' "GPT-4: 80% subsidized (\$2/\$6 vs \$10/\$30)"
printf 'Llama models: FREE for all users\n\n'
printf 'Review providerCost and billedCost in the active config before billing users.\n'
