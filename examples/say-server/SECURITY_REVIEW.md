# Say Server - Security Design Document

**Service**: MCP Say Server (Text-to-Speech)
**Location**: GCP Cloud Run, `us-east1`
**Project**: `mcp-apps-say-server`
**Date**: January 2026

---

## 1. Overview

The Say Server is an MCP (Model Context Protocol) application that provides real-time text-to-speech functionality. It demonstrates streaming audio generation with karaoke-style text highlighting.

### What It Does

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Say Server                                      │
│                                                                              │
│  1. Claude streams text to say() tool call arguments                        │
│  2. Host forwards partial input to MCP App (widget in iframe)               │
│  3. Widget receives via ontoolinputpartial, sends to server queue           │
│  4. Server generates audio chunks (CPU-bound TTS via pocket-tts)            │
│  5. Widget polls for audio, plays via Web Audio API                         │
│  6. Text highlighting synced with audio playback (karaoke-style)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| `server.py` | Self-contained MCP server with TTS tools |
| `pocket-tts` | Neural TTS model (Kyutai, Apache 2.0) |
| Widget HTML | React-based UI for playback control |
| MCP Protocol | Streamable HTTP transport with session support |

---

## 2. Architecture Diagrams

### 2.1 High-Level Data Flow

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Claude  │────▶│  MCP Host    │────▶│   Say Server    │────▶│  TTS Model   │
│  (LLM)   │     │  (Client)    │     │  (Cloud Run)    │     │  (pocket-tts)│
└──────────┘     └──────────────┘     └─────────────────┘     └──────────────┘
     │                  │                      │
     │ streams tool     │ forwards to         │ generates audio
     │ call arguments   │ MCP App (widget)    │
     ▼                  ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│  Claude streams text ──▶ Host forwards partial ──▶ Widget receives via       │
│  to say() tool input     tool input to iframe      ontoolinputpartial()      │
│                                                                               │
│  Widget calls server:                                                         │
│    create_tts_queue(voice) ──▶ queue_id                                      │
│    add_tts_text(queue_id, "Hello wor...")                                    │
│    add_tts_text(queue_id, "ld!")                                             │
│    end_tts_queue(queue_id)                                                   │
│                                                                               │
│  Widget polls for audio:                                                      │
│    poll_tts_audio(queue_id) ◀─── {chunks: [{audio_base64, ...}], done}      │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key insight**: The widget (MCP App) is the active party - it receives streamed text from Claude via the host, then independently calls server tools to manage TTS generation.

### 2.2 Queue Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Server Process Memory                                │
│                                                                              │
│  tts_queues: Dict[str, TTSQueueState]                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │  "a1b2c3d4e5f6" ──▶ TTSQueueState {                                 │    │
│  │                        id: "a1b2c3d4e5f6"                           │    │
│  │                        text_queue: AsyncQueue ◀── text chunks       │    │
│  │                        audio_chunks: List ──▶ generated audio       │    │
│  │                        chunks_delivered: int                         │    │
│  │                        status: "active" | "complete" | "error"      │    │
│  │                        task: AsyncTask (background TTS)              │    │
│  │                     }                                                │    │
│  │                                                                      │    │
│  │  "x7y8z9a0b1c2" ──▶ TTSQueueState { ... } (different session)       │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Information Flow: Text → Audio

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  CLIENT (Widget)                    SERVER (Cloud Run)                       │
│  ──────────────────                 ──────────────────                       │
│                                                                              │
│  1. create_tts_queue(voice) ─────▶ Creates TTSQueueState                    │
│     ◀───────────────────────────── Returns {queue_id, sample_rate}          │
│                                                                              │
│  2. add_tts_text(queue_id, "He") ─▶ Queues text                             │
│     add_tts_text(queue_id, "llo")─▶ Queues text                             │
│     add_tts_text(queue_id, " ") ──▶ Queues text                             │
│                                     │                                        │
│                                     ▼                                        │
│                              ┌──────────────────┐                           │
│                              │ Background Task  │                           │
│                              │ ─────────────────│                           │
│                              │ StreamingChunker │                           │
│                              │ buffers text     │                           │
│                              │ until sentence   │                           │
│                              │ boundary         │                           │
│                              │        │         │                           │
│                              │        ▼         │                           │
│                              │ TTS Model        │                           │
│                              │ generates audio  │                           │
│                              │ (run_in_executor)│                           │
│                              │        │         │                           │
│                              │        ▼         │                           │
│                              │ audio_chunks[]   │                           │
│                              └──────────────────┘                           │
│                                                                              │
│  3. poll_tts_audio(queue_id) ────▶ Returns new chunks since last poll      │
│     ◀──────────────────────────── {chunks: [...], done: false}             │
│     poll_tts_audio(queue_id) ────▶                                          │
│     ◀──────────────────────────── {chunks: [...], done: true}              │
│                                                                              │
│  4. end_tts_queue(queue_id) ─────▶ Signals EOF, flushes remaining text     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Polling Mechanism

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Widget Polling Loop                                  │
│                                                                              │
│  while (!done) {                                                            │
│    response = await callServerTool("poll_tts_audio", {queue_id})            │
│                                                                              │
│    for (chunk of response.chunks) {                                         │
│      // Decode base64 audio                                                 │
│      // Schedule on Web Audio API                                           │
│      // Track timing for text sync                                          │
│    }                                                                         │
│                                                                              │
│    if (response.chunks.length > 0) {                                        │
│      await sleep(20ms)   // Fast poll during active streaming               │
│    } else {                                                                  │
│      await sleep(50-150ms)  // Exponential backoff when waiting             │
│    }                                                                         │
│  }                                                                           │
│                                                                              │
│  Server-side:                                                                │
│  ─────────────                                                               │
│  - chunks_delivered tracks what client has seen                             │
│  - poll returns audio_chunks[chunks_delivered:]                             │
│  - Updates chunks_delivered after each poll                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Session & Queue Isolation

### 3.1 Session Isolation Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Session A (User 1)                    Session B (User 2)                   │
│  ──────────────────                    ──────────────────                   │
│                                                                              │
│  queue_id: "a1b2c3d4e5f6"              queue_id: "x7y8z9a0b1c2"            │
│           │                                      │                          │
│           ▼                                      ▼                          │
│  ┌─────────────────┐                   ┌─────────────────┐                  │
│  │ TTSQueueState A │                   │ TTSQueueState B │                  │
│  │                 │                   │                 │                  │
│  │ text: "Hello"   │                   │ text: "Goodbye" │                  │
│  │ audio: [...]    │                   │ audio: [...]    │                  │
│  │ voice: cosette  │                   │ voice: alba     │                  │
│  └─────────────────┘                   └─────────────────┘                  │
│                                                                              │
│  ✓ Each queue is completely independent                                     │
│  ✓ Queue ID is the only "key" to access data                               │
│  ✓ No shared state between queues                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Queue ID as Access Token

```python
# Queue creation generates random 12-char hex ID
queue_id = uuid.uuid4().hex[:12]  # e.g., "a1b2c3d4e5f6"

# All operations require queue_id
add_tts_text(queue_id, text)      # Only works if you know the ID
poll_tts_audio(queue_id)          # Only returns YOUR queue's audio
end_tts_queue(queue_id)           # Only ends YOUR queue
```

**Entropy**: 12 hex chars = 48 bits = 281 trillion possible values

---

## 4. CPU Isolation (TTS Processing)

### 4.1 Thread Pool Isolation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Main Event Loop (asyncio)                                                  │
│  ─────────────────────────                                                  │
│  - Handles HTTP requests                                                    │
│  - Manages queue state                                                      │
│  - Non-blocking operations                                                  │
│                                                                              │
│         │                                                                    │
│         │ run_in_executor()                                                 │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Thread Pool Executor                              │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │  Thread 1   │  │  Thread 2   │  │  Thread 3   │  ...             │    │
│  │  │  Queue A    │  │  Queue B    │  │  Queue C    │                  │    │
│  │  │  TTS work   │  │  TTS work   │  │  TTS work   │                  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │    │
│  │                                                                      │    │
│  │  - Each queue's TTS runs in separate thread                         │    │
│  │  - CPU-bound work doesn't block event loop                          │    │
│  │  - Natural isolation via thread boundaries                          │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 No Shared TTS State

```python
# Each queue gets its own model state copy
model_state = tts_model._cached_get_state_for_audio_prompt(voice, truncate=True)

# Audio generation uses copy_state=True
for audio_chunk in tts_model._generate_audio_stream_short_text(
    model_state=model_state,
    text_to_generate=text,
    copy_state=True,  # ← Ensures isolation
):
    ...
```

---

## 5. Need for Session Stickiness

### 5.1 Why Stickiness is Required

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  WITHOUT Stickiness (BROKEN)                                                │
│  ───────────────────────────                                                │
│                                                                              │
│  Request 1: create_tts_queue() ──▶ Instance A ──▶ queue_id: "abc123"       │
│  Request 2: add_tts_text("abc123") ──▶ Instance B ──▶ "Queue not found!" ✗ │
│                                                                              │
│  The queue exists only in Instance A's memory!                              │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WITH Stickiness (WORKING)                                                  │
│  ─────────────────────────                                                  │
│                                                                              │
│  Request 1: create_tts_queue()                                              │
│             mcp-session-id: xyz ──▶ Instance A ──▶ queue_id: "abc123"      │
│                                                                              │
│  Request 2: add_tts_text("abc123")                                          │
│             mcp-session-id: xyz ──▶ Instance A ──▶ Text queued ✓           │
│             (same session ID → same instance)                               │
│                                                                              │
│  Request 3: poll_tts_audio("abc123")                                        │
│             mcp-session-id: xyz ──▶ Instance A ──▶ Audio chunks ✓          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 MCP Session Protocol

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  First Request (no session)                                                 │
│  ──────────────────────────                                                 │
│                                                                              │
│  POST /mcp                                                                  │
│  Content-Type: application/json                                             │
│  (no mcp-session-id header)                                                 │
│                                                                              │
│  Response:                                                                   │
│  mcp-session-id: sess_abc123xyz  ◀── Server generates session ID           │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Subsequent Requests                                                        │
│  ───────────────────                                                        │
│                                                                              │
│  POST /mcp                                                                  │
│  Content-Type: application/json                                             │
│  mcp-session-id: sess_abc123xyz  ◀── Client sends back session ID          │
│                                                                              │
│  Load Balancer:                                                              │
│  - Hashes "sess_abc123xyz"                                                  │
│  - Routes to same instance via consistent hashing                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Security Analysis

### 6.1 Attack: Accessing Another User's Queue

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ATTACK SCENARIO                                                            │
│  ───────────────                                                            │
│                                                                              │
│  Attacker wants to:                                                         │
│  1. Read audio from victim's queue                                          │
│  2. Inject text into victim's queue                                         │
│  3. Cancel victim's queue                                                   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ATTACK REQUIREMENTS                                                        │
│  ───────────────────                                                        │
│                                                                              │
│  1. Know victim's queue_id (12-char hex = 48 bits entropy)                 │
│     - Not exposed in any API response                                       │
│     - Not in URLs, logs, or error messages                                  │
│     - Only returned to queue creator                                        │
│                                                                              │
│  2. Be routed to same Cloud Run instance (for in-memory access)            │
│     - Requires matching mcp-session-id hash                                 │
│     - Session IDs are also random and not exposed                           │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WHY IT'S NOT POSSIBLE                                                      │
│  ─────────────────────                                                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                                                                 │         │
│  │  Brute Force Analysis:                                         │         │
│  │                                                                 │         │
│  │  Queue ID space: 16^12 = 281,474,976,710,656 possibilities     │         │
│  │  Queue lifetime: ~30 seconds (timeout) to ~5 minutes (usage)   │         │
│  │  Concurrent queues: typically 1-10 per instance                │         │
│  │                                                                 │         │
│  │  Probability of guessing valid queue_id:                       │         │
│  │  P = active_queues / total_space                               │         │
│  │  P = 10 / 281,474,976,710,656                                  │         │
│  │  P ≈ 3.5 × 10^-14                                              │         │
│  │                                                                 │         │
│  │  At 1000 requests/second, expected time to find valid ID:      │         │
│  │  T = 281,474,976,710,656 / 10 / 1000 seconds                   │         │
│  │  T ≈ 891 years                                                  │         │
│  │                                                                 │         │
│  └────────────────────────────────────────────────────────────────┘         │
│                                                                              │
│  Additional Barriers:                                                        │
│  - Rate limiting would kick in                                              │
│  - Queue expires before brute force succeeds                                │
│  - Attacker's requests go to different instances (session affinity)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Attack: Session ID Enumeration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ATTACK: Guess mcp-session-id to route to victim's instance                │
│                                                                              │
│  WHY IT FAILS:                                                              │
│  ─────────────                                                              │
│                                                                              │
│  1. Session IDs are server-generated (not predictable)                     │
│  2. Even if routed to same instance, still need queue_id                   │
│  3. Session ID ≠ Queue ID (they're independent)                            │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                                                                 │         │
│  │  Attacker sends:                                               │         │
│  │  mcp-session-id: guessed_value                                 │         │
│  │                     │                                          │         │
│  │                     ▼                                          │         │
│  │  Load Balancer routes to Instance X (based on hash)            │         │
│  │                     │                                          │         │
│  │                     ▼                                          │         │
│  │  Attacker calls poll_tts_audio(guessed_queue_id)               │         │
│  │                     │                                          │         │
│  │                     ▼                                          │         │
│  │  Server: "Queue not found" (queue_id is still wrong)           │         │
│  │                                                                 │         │
│  └────────────────────────────────────────────────────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Data Exposure Summary

| Data | Exposed To | Risk Level |
|------|------------|------------|
| Queue ID | Only queue creator | 🟢 Low |
| Session ID | Only session holder | 🟢 Low |
| Input text | Only queue owner (via poll) | 🟢 Low |
| Audio data | Only queue owner (via poll) | 🟢 Low |
| Voice name | Only queue owner | 🟢 Low |

### 6.4 Potential Improvements (Not Required)

| Enhancement | Benefit | Complexity |
|-------------|---------|------------|
| Sign queue IDs with HMAC | Prevent any forged IDs | Medium |
| Bind queue to session ID | Defense in depth | Low |
| Encrypt audio in transit | Already HTTPS | N/A |
| Add queue access logging | Audit trail | Low |

---

## 7. Deployment Security

### 7.1 Current Controls

| Control | Status | Notes |
|---------|--------|-------|
| HTTPS (Cloud Run) | ✅ | Enforced by default |
| Container sandbox | ✅ | gVisor isolation |
| No persistent storage | ✅ | Stateless design |
| No secrets in code | ✅ | Uses public HuggingFace models |
| Queue auto-cleanup | ✅ | 30s timeout, 60s post-completion |

### 7.2 Pending for Public Access

| Requirement | Status | Action Needed |
|-------------|--------|---------------|
| Org policy exception | ❌ | Add `allUsersAccess` tag + `allUsers` invoker |
| HTTPS on Load Balancer | ❌ | Add SSL certificate |
| Rate limiting | ⚠️ | Consider Cloud Armor |
| Max instances limit | ⚠️ | Set scaling constraints for cost control |

### 7.3 Enabling Public Access (Reference: mcp-server-everything)

Based on the [Hosted Everything MCP Server](https://docs.google.com/document/d/138rvE5iLeSAJKljo9mNMftvUyjIuvf4tn20oVz7hojY) deployment, public access requires:

```bash
# Step 1: Add allUsersAccess tag to exempt from Domain Restricted Sharing
# Requires: roles/resourcemanager.tagUser at org level (or "GCP Org - Tag Admin Access" 2PC role)
gcloud resource-manager tags bindings create \
    --tag-value=tagValues/281479845332531 \
    --parent=//run.googleapis.com/projects/mcp-apps-say-server/locations/us-east1/services/say-server \
    --location=us-east1

# Step 2: Allow unauthenticated invocations
gcloud run services add-iam-policy-binding say-server \
    --project=mcp-apps-say-server \
    --member="allUsers" \
    --role="roles/run.invoker" \
    --region=us-east1

# Step 3: Set max instances for cost control
gcloud run services update say-server \
    --max-instances=5 \
    --region=us-east1 \
    --project=mcp-apps-say-server
```

**Prerequisites**:
- `GCP Org - Tag Admin Access` 2PC role (or `roles/resourcemanager.tagUser`)
- `roles/run.admin` or security admin permissions

### 7.4 Recommended Application-Level Security (from mcp-server-everything)

Once public, implement these hardening measures:

**Priority 1 (Critical)**:
```javascript
// Rate limiting per IP
const rateLimit = require('express-rate-limit');
app.use('/mcp', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
}));

// Request size limits
app.use(express.json({ limit: '10mb' }));

// Request timeout
app.use(timeout('30s'));
```

**Priority 2 (Important)**:
- Budget alerts configured
- Security monitoring and alerting
- Periodic queue cleanup (already implemented: 30s timeout, 60s post-cleanup)

### 7.5 Security Verdict (Aligned with mcp-server-everything)

**✅ SECURE for Testing/Demo Purposes** because:
1. **No sensitive data** processed or stored
2. **Infrastructure properly isolated** (Cloud Run sandbox)
3. **Worst-case scenario** is cost incurrence or service disruption
4. **Purpose-built for testing** with clear boundaries
5. **Queue auto-cleanup** prevents data accumulation

**Comparison with mcp-server-everything**:

| Aspect | mcp-server-everything | say-server |
|--------|----------------------|------------|
| State storage | Redis (VPC) | In-memory (per instance) |
| Session mgmt | Redis-backed | Queue ID + session affinity |
| Public access | ✅ Enabled | ❌ Pending |
| Rate limiting | Application-level | Not yet implemented |
| Max instances | 5 | 10 (should reduce) |

---

## 8. Appendix: Queue Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  QUEUE STATES                                                               │
│  ────────────                                                               │
│                                                                              │
│  create_tts_queue()                                                         │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │   ACTIVE    │◀─── add_tts_text() ───┐                                   │
│  │             │                        │                                    │
│  │ Processing  │────────────────────────┘                                   │
│  └─────────────┘                                                            │
│         │                                                                    │
│         │ end_tts_queue() or timeout                                        │
│         ▼                                                                    │
│  ┌─────────────┐     ┌─────────────┐                                        │
│  │  COMPLETE   │ or  │   ERROR     │                                        │
│  │             │     │             │                                        │
│  │ All audio   │     │ Timeout or  │                                        │
│  │ generated   │     │ exception   │                                        │
│  └─────────────┘     └─────────────┘                                        │
│         │                   │                                                │
│         └─────────┬─────────┘                                               │
│                   │                                                          │
│                   ▼                                                          │
│         60 seconds after done                                               │
│                   │                                                          │
│                   ▼                                                          │
│            [Queue Removed]                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. References

- **[Hosted Everything MCP Server](https://docs.google.com/document/d/138rvE5iLeSAJKljo9mNMftvUyjIuvf4tn20oVz7hojY)** - Jerome's deployment guide for `mcp-server-everything`, used as reference for security patterns and public access setup
- **[How to set up public Cloud Run services](https://outline.ant.dev/doc/how-to-set-up-public-cloud-run-services-zv7t2CPClu)** - Anthropic internal guide for org policy exemptions
- **[MCP Apps SDK Specification](../../specification/draft/apps.mdx)** - Protocol spec for MCP Apps

---

## 10. Contact & Approval

**Owner**: ochafik@anthropic.com
**Repository**: github.com/modelcontextprotocol/ext-apps
**Component**: examples/say-server

### Approval Checklist

- [ ] Security review completed
- [ ] Org policy exception approved (`allUsersAccess` tag applied)
- [ ] HTTPS configured on load balancer
- [ ] Max instances set to 5 (cost control)
- [ ] Rate limiting configured (optional)
- [ ] Monitoring/alerting set up
