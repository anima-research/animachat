#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/setup-config-test.XXXXXX")"
trap 'rm -rf -- "${test_dir:?}"' EXIT

target="$test_dir/.env"
cp "$script_dir/../env.example" "$target"
chmod 0644 "$target"

output="$(
    printf '%s\n' \
        'sk-ant-test/with+slash=' \
        'sk-or-test/with+slash=' \
        'AKIATESTACCESS1234' \
        'fake/secret+value=123' |
        bash "$script_dir/setup-config.sh" "$target" 2>/dev/null
)"

expected_lines=(
    'ANTHROPIC_API_KEY=sk-ant-test/with+slash='
    'OPENROUTER_API_KEY=sk-or-test/with+slash='
    'AWS_ACCESS_KEY_ID=AKIATESTACCESS1234'
    'AWS_SECRET_ACCESS_KEY=fake/secret+value=123'
)
for expected in "${expected_lines[@]}"; do
    if ! grep -Fqx -- "$expected" "$target"; then
        printf 'missing exact environment line: %s\n' "$expected" >&2
        exit 1
    fi
done

if ! grep -Fqx -- 'FRONTEND_URL=http://localhost:5173' "$target"; then
    printf 'an unrelated environment setting was not preserved\n' >&2
    exit 1
fi

for expected in \
    "Sonnet models: ~83% subsidized (\$0.50/\$2.50 vs \$3/\$15)" \
    "Opus models: 80% subsidized (\$3/\$15 vs \$15/\$75)" \
    "GPT-4: 80% subsidized (\$2/\$6 vs \$10/\$30)"; do
    if ! grep -Fqx -- "$expected" <<< "$output"; then
        printf 'missing literal pricing line: %s\n' "$expected" >&2
        exit 1
    fi
done

if [[ "$(uname -s)" == 'Darwin' ]]; then
    file_mode="$(stat -f '%Lp' "$target")"
else
    file_mode="$(stat -c '%a' "$target")"
fi
if [[ "$file_mode" != '600' ]]; then
    printf 'environment file mode is %s, expected 600\n' "$file_mode" >&2
    exit 1
fi

if [[ -e "$test_dir/config.json" ]]; then
    printf 'obsolete config.json credential file was created\n' >&2
    exit 1
fi

symlink_target="$test_dir/real.env"
symlink_path="$test_dir/symlink.env"
printf 'PRESERVE=true\n' > "$symlink_target"
ln -s "$symlink_target" "$symlink_path"
if printf '%s\n' \
    'sk-ant-test-value' \
    'sk-or-test-value' \
    'AKIATESTACCESS1234' \
    'fake/secret+value=123' |
    bash "$script_dir/setup-config.sh" "$symlink_path" >/dev/null 2>&1; then
    printf 'setup unexpectedly accepted a symlink target\n' >&2
    exit 1
fi
if ! grep -Fqx -- 'PRESERVE=true' "$symlink_target"; then
    printf 'symlink target was modified\n' >&2
    exit 1
fi

printf 'setup-config security tests passed\n'
