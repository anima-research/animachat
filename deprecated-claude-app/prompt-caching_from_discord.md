# Prompt Caching for Claude Conversations

This document explains the prompt caching architecture used in Chapter II (Cyborgism server) for efficient multi-model conversations with Claude. The system reduces API costs by leveraging Anthropic's prompt caching feature to avoid re-processing stable conversation history.

## Overview

The caching system has three main components:

1. **Cache State Management** - Tracks conversation state per channel/thread
2. **Cache Boundary Calculation** - Determines where to place cache breakpoints
3. **API Integration** - Converts markers to vendor-specific cache control format

## Quick Start: Minimal Implementation

For a simple implementation that captures the core economy:

```python
import re
from typing import List, Dict, Any

CACHE_BREAKPOINT = "<|cache_breakpoint|>"

def build_prompt_with_cache(messages: List[Dict], messages_after_marker: int = 5) -> str:
    """
    Build a prompt with cache breakpoint marker.
    
    Args:
        messages: List of messages, newest first
        messages_after_marker: Number of recent messages to keep after the marker
                              (these won't be cached, will be re-processed each call)
    
    Returns:
        Formatted prompt string with cache breakpoint marker
    """
    if len(messages) <= messages_after_marker:
        # Not enough messages for caching to help
        return format_messages(messages)
    
    # Recent messages (after marker, not cached)
    recent = messages[:messages_after_marker]
    # Older messages (before marker, cached)
    cached = messages[messages_after_marker:]
    
    return format_messages(cached) + CACHE_BREAKPOINT + format_messages(recent)


def format_messages(messages: List[Dict]) -> str:
    """Format messages into prompt string. Customize for your format."""
    result = []
    for msg in reversed(messages):  # Reverse to get chronological order
        author = msg.get("author", "unknown")
        content = msg.get("content", "")
        result.append(f"<{author}> {content}")
    return "\n".join(result)


def prepare_for_anthropic_api(prompt: str, cache_type: str = "ephemeral") -> List[Dict]:
    """
    Convert prompt with cache breakpoint into Anthropic API message content format.
    
    Args:
        prompt: Prompt string potentially containing <|cache_breakpoint|> markers
        cache_type: Cache control type - "ephemeral", "5m", or "1h"
    
    Returns:
        List of content blocks for Anthropic Messages API
    """
    cache_type_map = {
        "ephemeral": {"type": "ephemeral"},
        "5m": {"type": "ephemeral", "ttl": "5m"},
        "1h": {"type": "ephemeral", "ttl": "1h"},
    }
    cache_control = cache_type_map.get(cache_type, {"type": "ephemeral"})
    
    sections = re.split(r"<\|cache_breakpoint\|>", prompt)
    
    if len(sections) == 1:
        # No cache markers
        return [{"type": "text", "text": prompt}]
    
    content = []
    # All sections except the last get cache_control
    for section in sections[:-1]:
        if section.strip():
            content.append({
                "type": "text",
                "text": section,
                "cache_control": cache_control
            })
    
    # Last section (after final marker) has no cache control
    if sections[-1].strip():
        content.append({
            "type": "text",
            "text": sections[-1]
        })
    
    return content


def get_anthropic_headers(cache_enabled: bool = True) -> Dict[str, str]:
    """Get required headers for Anthropic API with caching."""
    headers = {}
    if cache_enabled:
        headers["anthropic-beta"] = "prompt-caching-2024-07-31, extended-cache-ttl-2025-04-11"
    return headers


def strip_cache_breakpoints(text: str) -> str:
    """Remove cache breakpoint markers (for non-Anthropic vendors)."""
    return re.sub(r'<\|cache_breakpoint\|>', '', text)
```

## The Economy of Caching

### How It Saves Money

Anthropic's prompt caching works by storing the KV-cache state at marked positions. When subsequent requests share the same prefix up to a cache marker:

1. **Cache Write** (first request): You pay the full input token price PLUS a 25% surcharge for cache creation
2. **Cache Read** (subsequent requests): You pay only 10% of the input token price for cached content

### Break-Even Point

For caching to be economical:
- The cached content must be reused at least **4 times** within the TTL
- Cache TTL is 5 minutes by default (ephemeral), or can be extended to 5m/1h with beta features

### Example Cost Savings

For a 50,000 token conversation history with 5 responses:

| Scenario | Without Caching | With Caching |
|----------|-----------------|--------------|
| Request 1 | 50,000 tokens | 50,000 × 1.25 = 62,500 token-equiv |
| Request 2 | 50,000 tokens | 50,000 × 0.10 = 5,000 token-equiv |
| Request 3 | 50,000 tokens | 50,000 × 0.10 = 5,000 token-equiv |
| Request 4 | 50,000 tokens | 50,000 × 0.10 = 5,000 token-equiv |
| Request 5 | 50,000 tokens | 50,000 × 0.10 = 5,000 token-equiv |
| **Total** | **250,000** | **82,500** (67% savings) |

## Cache Marker Placement Strategy

The key insight is **cache stability across conversation turns**.

### The Three-Part Structure

Messages are divided into three regions:

```
[OLDEST MESSAGES - excluded from prompt]
────────────────────────────────────────
[MIDDLE MESSAGES - included, BEFORE cache marker, CACHED]
<|cache_breakpoint|>
[NEWEST MESSAGES - included, AFTER cache marker, NOT CACHED]
```

### Boundary Shifting vs. Rotation

As new messages arrive:

1. **Boundary Shifting**: The marker position shifts to keep tracking the *same* cached content
2. **Rotation**: After N messages (configurable), boundaries reset entirely

This ensures the cached content hash remains identical across multiple API calls.

```
Turn 1:  [msg1][msg2][msg3][msg4][msg5] <marker> [msg6][msg7]
Turn 2:  [msg1][msg2][msg3][msg4][msg5] <marker> [msg6][msg7][msg8]
         ↑ Same content before marker, cache HIT

Turn 3 (after rotation threshold):
         [msg3][msg4][msg5][msg6][msg7] <marker> [msg8][msg9]
         ↑ New cache position, cache WRITE
```

## Advanced: Minute-Based Chunking

For high-activity group chats, Chapter II uses a more sophisticated approach:

### Why Chunk by Minute?

1. **Deterministic hashing**: Messages within the same minute form a stable chunk
2. **Drift detection**: If the cached content "drifts" (new messages added mid-chunk), the system detects this
3. **Efficient matching**: Finding the longest matching subsequence of chunks is faster than comparing individual messages

### Chunk Sequence Matching

```python
def create_chunk_sequence(messages: List[Message], format_func) -> List[Tuple[int, str, int]]:
    """
    Create a sequence of (minute_timestamp, hash, message_count) tuples.
    
    Groups messages by minute boundary, hashes each group's formatted content.
    """
    chunks = {}  # minute_key -> list of messages
    
    for message in messages:
        if message.timestamp > 0:
            minute_key = int(message.timestamp // 60) * 60
            if minute_key not in chunks:
                chunks[minute_key] = []
            chunks[minute_key].append(message)
    
    sequence = []
    for minute_key in sorted(chunks.keys()):
        chunk_messages = chunks[minute_key]
        # Sort within chunk for consistent hashing
        sorted_msgs = sorted(chunk_messages, key=lambda m: m.timestamp)
        content = "".join(format_func(m) for m in sorted_msgs)
        chunk_hash = hashlib.sha256(content.encode()).hexdigest()
        sequence.append((minute_key, chunk_hash, len(chunk_messages)))
    
    return sequence


def find_longest_matching_subsequence(
    prev_sequence: List[Tuple], 
    curr_sequence: List[Tuple]
) -> Tuple[int, int, int]:
    """
    Find where the previous cached content now appears in the current sequence.
    
    Returns:
        (match_start_idx, match_length, oldest_matched_timestamp)
    """
    if not prev_sequence or not curr_sequence:
        return (-1, 0, -1)
    
    # Map (timestamp, hash) -> index in current sequence
    curr_map = {(ts, h): idx for idx, (ts, h, _) in enumerate(curr_sequence)}
    
    best_start, best_length, oldest_ts = -1, 0, -1
    
    for i, (ts, h, _) in enumerate(prev_sequence):
        if (ts, h) in curr_map:
            curr_idx = curr_map[(ts, h)]
            # Count consecutive matches
            length = 0
            j = 0
            while (i + j < len(prev_sequence) and 
                   curr_idx + j < len(curr_sequence) and
                   prev_sequence[i + j][:2] == curr_sequence[curr_idx + j][:2]):
                length += 1
                j += 1
            
            if length > best_length:
                best_start = curr_idx
                best_length = length
                oldest_ts = curr_sequence[curr_idx][0]
    
    return (best_start, best_length, oldest_ts)
```

## Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cache_enabled` | `True` | Enable/disable caching |
| `cache_extra_messages` | `40` | Messages beyond recency_window to keep for cache stability |
| `cache_rotation_step` | `20` | Messages before rotating cache boundaries |
| `cache_messages_after_marker` | `1` | Messages to keep after marker (uncached) |
| `recency_window` | `35` | Base number of recent messages to include |

## Vendor Support

### Direct Anthropic API ✅

Full support with `cache_control` on message content blocks.

```python
# Headers required
headers = {
    "anthropic-beta": "prompt-caching-2024-07-31, extended-cache-ttl-2025-04-11"
}

# Message format
messages = [{
    "role": "user",
    "content": [
        {"type": "text", "text": "..cached content..", "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "..recent content.."}
    ]
}]
```

### AWS Bedrock ✅

Supported via the AnthropicBedrock client with similar format.

### OpenRouter ❌

**Not currently supported.** Cache breakpoint markers are stripped before sending to OpenRouter.

OpenRouter uses the OpenAI-compatible API which doesn't have an equivalent to Anthropic's `cache_control` field. The markers are removed via `strip_cache_breakpoints()` to avoid sending malformed requests.

If OpenRouter adds prompt caching support in the future, integration would require:
1. Detecting the vendor/model combination
2. Converting markers to OpenRouter's cache format
3. Adding appropriate headers

### Other Vendors ❌

For all other vendors (AI21, Forefront, Gemini, OpenAI, etc.), cache markers are stripped.

## Cache State Per Context

Cache state is tracked **per conversation context** (e.g., channel ID, thread ID), **not per model**.

This means:
- Multiple models in the same channel share cache boundary calculations
- Switching models doesn't reset the cache state
- Each channel/thread has independent cache tracking

```python
class CacheState:
    def __init__(self, context_id: str):
        self.context_id = context_id
        self.chunk_sequence = []  # Previous chunks for matching
        self.last_message_count = 0
        self.last_boundaries = (0, 0, 0)  # (old_boundary, marker_pos, total)
        self.messages_since_rotation = 0
        self.marker_message_content = None  # Track message at marker for drift detection
```

## Security: Sanitizing User Input

Users could potentially inject `<|cache_breakpoint|>` markers to manipulate caching behavior. Always sanitize incoming messages:

```python
def sanitize_cache_markers(text: str) -> str:
    """Remove cache breakpoint markers from user input."""
    return text.replace("<|cache_breakpoint|>", "")
```

## Debugging Cache Behavior

Enable debug logging to understand cache decisions:

```
[DEBUG] cache_manager: Cache is enabled, received 50 messages for context channel_123
[DEBUG] cache_manager: match_start=3, match_length=42
[DEBUG] cache_manager: cache_hit=True
[DEBUG] cache_manager: Adjusting boundaries to track same messages
[DEBUG] cache_manager: new_marker=8 (was 5), new_old=47 (was 44)
```

Key metrics to monitor:
- **Cache hit rate**: Should be >80% in active conversations
- **Boundary shifts vs. rotations**: Too many rotations indicates instability
- **Messages since rotation**: Tracks accumulation toward next rotation

## Complete Example

```python
import anthropic
import asyncio
from typing import List, Dict

async def chat_with_caching(
    client: anthropic.AsyncAnthropic,
    messages: List[Dict],
    system_prompt: str,
    messages_after_marker: int = 3
):
    """
    Send a chat completion with prompt caching.
    
    Args:
        client: Anthropic async client
        messages: List of {"role": str, "content": str} messages
        system_prompt: System prompt (also cached)
        messages_after_marker: Recent messages to keep uncached
    """
    
    # Build content with cache markers
    content_blocks = []
    
    # System prompt gets cached
    content_blocks.append({
        "type": "text",
        "text": system_prompt,
        "cache_control": {"type": "ephemeral"}
    })
    
    # Format conversation history
    if len(messages) > messages_after_marker:
        # Older messages (cached)
        cached_msgs = messages[:-messages_after_marker]
        cached_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" 
            for m in cached_msgs
        )
        content_blocks.append({
            "type": "text",
            "text": cached_text,
            "cache_control": {"type": "ephemeral"}
        })
        
        # Recent messages (not cached)
        recent_msgs = messages[-messages_after_marker:]
        recent_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" 
            for m in recent_msgs
        )
        content_blocks.append({
            "type": "text",
            "text": recent_text
        })
    else:
        # Not enough messages, no caching benefit
        all_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" 
            for m in messages
        )
        content_blocks.append({
            "type": "text",
            "text": all_text
        })
    
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        extra_headers={
            "anthropic-beta": "prompt-caching-2024-07-31, extended-cache-ttl-2025-04-11"
        },
        messages=[{
            "role": "user",
            "content": content_blocks
        }]
    )
    
    # Check cache usage in response
    usage = response.usage
    print(f"Input tokens: {usage.input_tokens}")
    if hasattr(usage, 'cache_creation_input_tokens'):
        print(f"Cache creation tokens: {usage.cache_creation_input_tokens}")
    if hasattr(usage, 'cache_read_input_tokens'):
        print(f"Cache read tokens: {usage.cache_read_input_tokens}")
    
    return response.content[0].text
```

## References

- [Anthropic Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- Chapter II source: `cache_manager.py`, `cache_utils.py`, `intermodel/callgpt.py`

