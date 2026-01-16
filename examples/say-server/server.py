#!/usr/bin/env uv run --default-index https://pypi.org/simple
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp @ git+https://github.com/modelcontextprotocol/python-sdk@main",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
#     "pocket-tts>=1.0.1",
# ]
# ///
"""
Say Demo - MCP App for streaming text-to-speech.

This MCP server provides a "say" tool that speaks text using TTS.
The widget receives streaming partial input and starts speaking immediately.

Architecture:
- The `say` tool itself is a no-op - it just triggers the widget
- The widget uses `ontoolinputpartial` to receive text as it streams
- Widget calls private tools to create TTS queue, add text, and poll audio
- Audio plays in the widget using Web Audio API

Usage:
  # Start the MCP server
  python server.py

  # Or with stdio transport (for Claude Desktop)
  python server.py --stdio
"""
from __future__ import annotations
import asyncio
import base64
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal
from pydantic import Field

import torch
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp import types
from starlette.middleware.cors import CORSMiddleware

from pocket_tts.models.tts_model import TTSModel, prepare_text_prompt
from pocket_tts.default_parameters import DEFAULT_AUDIO_PROMPT

logger = logging.getLogger(__name__)

WIDGET_URI = "ui://say-demo/widget.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3109"))

mcp = FastMCP("Say Demo")

# Global TTS model (loaded on startup)
tts_model: TTSModel | None = None


# ------------------------------------------------------
# TTS Queue State Management
# ------------------------------------------------------

@dataclass
class AudioChunkData:
    """Audio chunk with timing metadata."""
    index: int
    audio_base64: str
    char_start: int
    char_end: int
    duration_ms: float


@dataclass
class TTSQueueState:
    """State for a TTS generation queue."""
    id: str
    voice: str
    sample_rate: int
    status: Literal["active", "complete", "error"] = "active"
    error_message: str | None = None

    # Text queue
    text_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    end_signaled: bool = False

    # Audio output
    audio_chunks: list[AudioChunkData] = field(default_factory=list)
    chunks_delivered: int = 0

    # Tracking
    created_at: float = field(default_factory=time.time)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task | None = None


# Active TTS queues
tts_queues: dict[str, TTSQueueState] = {}


# ------------------------------------------------------
# Public Tool: say
# ------------------------------------------------------

DEFAULT_TEXT = """Hello! I'm a text-to-speech demonstration. This speech is being generated in real-time as you watch. The words you see highlighted are synchronized with the audio playback, creating a karaoke-style reading experience. You can click to pause or resume, and use the reset button to restart from the beginning. Pretty neat, right?"""

# Predefined voices from pocket-tts (mapped to HuggingFace files)
# See: https://huggingface.co/kyutai/tts-voices
PREDEFINED_VOICES = {
    "alba": "hf://kyutai/tts-voices/alba-mackenna/casual.wav",
    "marius": "hf://kyutai/tts-voices/alba-mackenna/merchant.wav",
    "javert": "hf://kyutai/tts-voices/alba-mackenna/announcer.wav",
    "jean": "hf://kyutai/tts-voices/alba-mackenna/a-moment-by.wav",
    "fantine": "hf://kyutai/tts-voices/vctk/p225_023_mic1.wav",
    "cosette": "hf://kyutai/tts-voices/vctk/p226_023_mic1.wav",
    "eponine": "hf://kyutai/tts-voices/vctk/p227_023_mic1.wav",
    "azelma": "hf://kyutai/tts-voices/vctk/p228_023_mic1.wav",
}

DEFAULT_VOICE = "cosette"


@mcp.tool()
def list_voices() -> list[types.TextContent]:
    """List available TTS voices.

    Returns the predefined voice names that can be used with the say tool.
    You can also use HuggingFace URLs (hf://kyutai/tts-voices/...) or local file paths.
    """
    import json
    voice_info = {
        "predefined_voices": list(PREDEFINED_VOICES.keys()),
        "default_voice": DEFAULT_VOICE,
        "custom_voice_formats": [
            "hf://kyutai/tts-voices/<collection>/<file>.wav",
            "/path/to/local/voice.wav",
        ],
        "collections": [
            "alba-mackenna (CC BY 4.0) - voice-acted characters",
            "vctk (CC BY 4.0) - VCTK dataset speakers",
            "cml-tts/fr (CC BY 4.0) - French voices",
            "voice-donations (CC0) - community voices",
            "expresso (CC BY-NC 4.0) - expressive voices (non-commercial)",
            "ears (CC BY-NC 4.0) - emotional voices (non-commercial)",
        ],
    }
    return [types.TextContent(type="text", text=json.dumps(voice_info, indent=2))]


@mcp.tool(meta={
    "ui":{"resourceUri": WIDGET_URI},
    "ui/resourceUri": WIDGET_URI, # legacy support
})
def say(
    text: Annotated[str, Field(description="The English text to speak aloud")] = DEFAULT_TEXT,
    voice: Annotated[str, Field(
        description="Voice to use. Can be a predefined name (alba, marius, cosette, etc.), "
                    "a HuggingFace URL (hf://kyutai/tts-voices/...), or a local file path."
    )] = DEFAULT_VOICE,
    autoPlay: Annotated[bool, Field(
        description="Whether to start playing automatically. Note: browsers may block autoplay until user interaction."
    )] = True,
) -> list[types.TextContent]:
    """Speak English text aloud using text-to-speech.

    Use when the user wants text read or spoken aloud:
    - "say ...", "speak ...", "read ... out loud"
    - "...; say it", "...; read it to me", "...; speak it"
    - "narrate ...", "read this aloud"

    Audio streams in real-time as text is provided.
    Use list_voices() for voice options.

    Note: English only. Non-English text may produce poor or garbled results.
    """
    # This is a no-op - the widget handles everything via ontoolinputpartial
    # The tool exists to:
    # 1. Trigger the widget to load
    # 2. Provide the resourceUri metadata
    # 3. Show the final text in the tool result
    return [types.TextContent(type="text", text=f"Displayed a TTS widget with voice '{voice}'. Click to play/pause, use toolbar to restart or fullscreen.")]


# ------------------------------------------------------
# Private Tools: TTS Queue Management
# ------------------------------------------------------

@mcp.tool(meta={"ui":{"visibility":["app"]}})
def create_tts_queue(voice: str = "cosette") -> list[types.TextContent]:
    """Create a TTS generation queue. Returns queue_id and sample_rate.

    Args:
        voice: Voice to use (cosette, alba, brenda, etc.)
    """
    if tts_model is None:
        return [types.TextContent(type="text", text='{"error": "TTS model not loaded"}')]

    queue_id = uuid.uuid4().hex[:12]
    sample_rate = tts_model.config.mimi.sample_rate

    state = TTSQueueState(
        id=queue_id,
        voice=voice,
        sample_rate=sample_rate,
    )
    tts_queues[queue_id] = state

    # Start background TTS processing task
    loop = asyncio.get_event_loop()
    state.task = loop.create_task(_run_tts_queue(state))

    logger.info(f"Created TTS queue {queue_id}")

    import json
    return [types.TextContent(
        type="text",
        text=json.dumps({"queue_id": queue_id, "sample_rate": sample_rate})
    )]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def add_tts_text(queue_id: str, text: str) -> list[types.TextContent]:
    """Add text to a TTS queue.

    Args:
        queue_id: The queue ID from create_tts_queue
        text: Text to add (incremental, not cumulative)
    """
    state = tts_queues.get(queue_id)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]
    if state.end_signaled:
        return [types.TextContent(type="text", text='{"error": "Queue already ended"}')]

    # Queue the text (non-blocking)
    try:
        state.text_queue.put_nowait(text)
    except asyncio.QueueFull:
        return [types.TextContent(type="text", text='{"error": "Queue full"}')]

    # BACKPRESSURE: Return queue depth so widget can throttle:
    # import json
    # return [types.TextContent(type="text", text=json.dumps({
    #     "queued": True,
    #     "queue_depth": state.text_queue.qsize()
    # }))]

    return [types.TextContent(type="text", text='{"queued": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def end_tts_queue(queue_id: str) -> list[types.TextContent]:
    """Signal that no more text will be sent to a queue.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    state = tts_queues.get(queue_id)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]
    if state.end_signaled:
        return [types.TextContent(type="text", text='{"already_ended": true}')]

    state.end_signaled = True
    try:
        state.text_queue.put_nowait(None)  # EOF marker
    except asyncio.QueueFull:
        pass

    return [types.TextContent(type="text", text='{"ended": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def cancel_tts_queue(queue_id: str) -> list[types.TextContent]:
    """Cancel and cleanup a TTS queue. Use before creating a new queue to avoid overlapping playback.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    state = tts_queues.pop(queue_id, None)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]

    # Cancel the background task
    if state.task and not state.task.done():
        state.task.cancel()
        logger.info(f"Cancelled TTS queue {queue_id}")

    # Signal end to unblock any waiting consumers
    state.end_signaled = True
    try:
        state.text_queue.put_nowait(None)
    except asyncio.QueueFull:
        pass

    state.status = "complete"

    return [types.TextContent(type="text", text='{"cancelled": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def poll_tts_audio(queue_id: str) -> list[types.TextContent]:
    """Poll for available audio chunks from a TTS queue.

    Returns base64-encoded audio chunks with timing metadata.
    Call repeatedly until done=true.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    import json

    state = tts_queues.get(queue_id)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]

    # Get new chunks (use sync approach since we can't await in tool)
    # The lock is async, so we need to be careful here
    # For simplicity, just grab what's available without locking
    new_chunks = state.audio_chunks[state.chunks_delivered:]
    state.chunks_delivered = len(state.audio_chunks)

    done = state.status == "complete" and state.chunks_delivered >= len(state.audio_chunks)

    response = {
        "chunks": [
            {
                "index": c.index,
                "audio_base64": c.audio_base64,
                "char_start": c.char_start,
                "char_end": c.char_end,
                "duration_ms": c.duration_ms,
            }
            for c in new_chunks
        ],
        "done": done,
        "status": state.status,
    }

    # Clean up completed queues
    if done:
        # Schedule cleanup after a delay
        async def cleanup():
            await asyncio.sleep(60)
            tts_queues.pop(queue_id, None)
        try:
            asyncio.get_event_loop().create_task(cleanup())
        except RuntimeError:
            pass

    return [types.TextContent(type="text", text=json.dumps(response))]


# ------------------------------------------------------
# Background TTS Processing
# ------------------------------------------------------


class StreamingTextChunker:
    """Buffers streaming text and emits chunks when ready for TTS processing.

    Chunks are emitted when:
    - Token count reaches max_tokens threshold (at a sentence boundary if possible)
    - flush() is called (end of stream)

    This matches the chunking behavior of split_into_best_sentences() but works
    incrementally as text arrives.
    """

    def __init__(self, tokenizer, max_tokens: int = 50, min_tokens: int = 15):
        """
        Args:
            tokenizer: SentencePiece tokenizer from flow_lm.conditioner.tokenizer
            max_tokens: Maximum tokens per chunk (default 50, matches existing)
            min_tokens: Minimum tokens before considering emission
        """
        self.tokenizer = tokenizer
        self.max_tokens = max_tokens
        self.min_tokens = min_tokens
        self.buffer = ""

        # Cache end-of-sentence token IDs for boundary detection
        _, *eos_tokens = tokenizer(".!...?").tokens[0].tolist()
        self.eos_tokens = set(eos_tokens)

    def add_text(self, text: str) -> list[str]:
        """Add text to buffer, return any complete chunks ready for processing.

        Args:
            text: Incremental text to add (e.g., from LLM token)

        Returns:
            List of text chunks ready for TTS (may be empty if still buffering)
        """
        self.buffer += text
        return self._extract_ready_chunks()

    def flush(self) -> list[str]:
        """Flush remaining buffer as final chunk(s).

        Call this when the text stream ends to process any remaining text.

        Returns:
            List of final text chunks (may be empty if buffer was empty)
        """
        if not self.buffer.strip():
            return []

        # Force emit whatever remains
        chunks = self._extract_ready_chunks(force_emit=True)
        if self.buffer.strip():
            chunks.append(self.buffer.strip())
            self.buffer = ""
        return chunks

    def _extract_ready_chunks(self, force_emit: bool = False) -> list[str]:
        """Extract chunks that are ready for processing."""
        chunks = []

        while True:
            chunk = self._try_extract_chunk(force_emit and not chunks)
            if chunk is None:
                break
            chunks.append(chunk)

        return chunks

    def _try_extract_chunk(self, force_emit: bool = False) -> str | None:
        """Try to extract one chunk from buffer."""
        text = self.buffer.strip()
        if not text:
            return None

        tokens = self.tokenizer(text).tokens[0].tolist()
        num_tokens = len(tokens)

        # Not enough tokens yet
        if num_tokens < self.min_tokens and not force_emit:
            return None

        # Under max and not forcing - check for complete sentence worth emitting
        if num_tokens < self.max_tokens and not force_emit:
            # Only emit early if we have a complete sentence at a good length
            if num_tokens >= self.min_tokens and self._ends_with_sentence_boundary(tokens):
                # Found a complete sentence - emit it
                chunk = text
                self.buffer = ""
                return chunk
            return None

        # Over max_tokens or force_emit - find best split point
        split_idx = self._find_best_split(tokens, force_emit)

        if split_idx == 0:
            if force_emit:
                chunk = text
                self.buffer = ""
                return chunk
            return None

        # Decode tokens up to split point
        chunk_text = self.tokenizer.sp.decode(tokens[:split_idx])
        remaining_text = self.tokenizer.sp.decode(tokens[split_idx:])

        self.buffer = remaining_text
        return chunk_text.strip()

    def _find_best_split(self, tokens: list[int], force_emit: bool = False) -> int:
        """Find the best token index to split at (sentence boundary near max_tokens)."""
        # Find all sentence boundaries (position AFTER the punctuation)
        boundaries = []
        prev_was_eos = False

        for i, token in enumerate(tokens):
            if token in self.eos_tokens:
                prev_was_eos = True
            elif prev_was_eos:
                boundaries.append(i)
                prev_was_eos = False

        # Also consider end of tokens if it ends with punctuation
        if tokens and tokens[-1] in self.eos_tokens:
            boundaries.append(len(tokens))

        if not boundaries:
            # No sentence boundaries - split at max_tokens if we're over
            if len(tokens) >= self.max_tokens:
                return self.max_tokens
            return len(tokens) if force_emit else 0

        # Find boundary closest to max_tokens without going too far over
        best_boundary = 0
        for boundary in boundaries:
            if boundary <= self.max_tokens:
                best_boundary = boundary
            elif best_boundary == 0:
                # First boundary is past max - use it anyway
                best_boundary = boundary
                break
            else:
                # We have a good boundary before max, stop
                break

        return best_boundary

    def _ends_with_sentence_boundary(self, tokens: list[int]) -> bool:
        """Check if token sequence ends with sentence-ending punctuation."""
        if not tokens:
            return False
        return tokens[-1] in self.eos_tokens

    @property
    def buffered_text(self) -> str:
        """Current buffered text (for debugging/monitoring)."""
        return self.buffer

    @property
    def buffered_token_count(self) -> int:
        """Approximate token count in buffer."""
        if not self.buffer.strip():
            return 0
        return len(self.tokenizer(self.buffer).tokens[0].tolist())


async def _run_tts_queue(state: TTSQueueState):
    """Background task: consume text queue, produce audio chunks."""
    if tts_model is None:
        state.status = "error"
        state.error_message = "TTS model not loaded"
        return

    model_state = tts_model._cached_get_state_for_audio_prompt(state.voice, truncate=True)
    chunker = StreamingTextChunker(tts_model.flow_lm.conditioner.tokenizer)
    chunk_index = 0
    char_offset = 0

    try:
        while True:
            text_item = await state.text_queue.get()

            if text_item is None:
                # EOF - flush remaining text
                remaining = chunker.flush()
                for chunk_text in remaining:
                    await _process_tts_chunk(state, chunk_text, chunk_index, char_offset, model_state)
                    char_offset += len(chunk_text)
                    chunk_index += 1

                state.status = "complete"
                logger.info(f"TTS queue {state.id} complete: {chunk_index} chunks")
                break

            # Feed text to chunker
            ready_chunks = chunker.add_text(text_item)

            for chunk_text in ready_chunks:
                await _process_tts_chunk(state, chunk_text, chunk_index, char_offset, model_state)
                char_offset += len(chunk_text)
                chunk_index += 1

    except Exception as e:
        logger.error(f"TTS queue {state.id} error: {e}")
        state.status = "error"
        state.error_message = str(e)


async def _process_tts_chunk(
    state: TTSQueueState,
    text: str,
    chunk_index: int,
    char_offset: int,
    model_state: dict,
):
    """Process a text chunk and add audio to state."""
    if tts_model is None:
        return

    loop = asyncio.get_event_loop()
    audio_bytes_list: list[bytes] = []
    total_samples = 0

    def generate_sync():
        nonlocal total_samples
        _, frames_after_eos = prepare_text_prompt(text)
        frames_after_eos += 2

        for audio_chunk in tts_model._generate_audio_stream_short_text(
            model_state=model_state,
            text_to_generate=text,
            frames_after_eos=frames_after_eos,
            copy_state=True,
        ):
            audio_int16 = (audio_chunk * 32767).to(torch.int16)
            audio_bytes_list.append(audio_int16.cpu().numpy().tobytes())
            total_samples += len(audio_chunk)

    await loop.run_in_executor(None, generate_sync)

    combined_audio = b"".join(audio_bytes_list)
    duration_ms = (total_samples / state.sample_rate) * 1000

    chunk_data = AudioChunkData(
        index=chunk_index,
        audio_base64=base64.b64encode(combined_audio).decode(),
        char_start=char_offset,
        char_end=char_offset + len(text),
        duration_ms=duration_ms,
    )

    async with state.lock:
        state.audio_chunks.append(chunk_data)

    logger.debug(f"TTS queue {state.id}: chunk {chunk_index} ready ({duration_ms:.0f}ms)")


# ------------------------------------------------------
# Widget Resource
# ------------------------------------------------------

# Embedded widget HTML for standalone execution via `uv run <url>`
# Uses Babel standalone for in-browser JSX transpilation
# This is a copy of widget.html - keep them in sync!
EMBEDDED_WIDGET_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Say Widget</title>
  <script src="https://unpkg.com/@babel/standalone@7.26.10/babel.min.js"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.2.0",
      "react-dom/client": "https://esm.sh/react-dom@19.2.0/client",
      "@modelcontextprotocol/ext-apps/react": "https://esm.sh/@modelcontextprotocol/ext-apps@0.4.1/react?deps=zod@3.25.1&external=react,react-dom"
    }
  }
  </script>
  <style>
    :root {
      /* Fallback values if host doesn't provide */
      --font-sans: system-ui, -apple-system, sans-serif;
      --color-text-primary: #333;
      --color-text-secondary: #999;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); }
    .container { padding: 16px; min-height: 100px; position: relative; outline: none; }
    .textWrapper { position: relative; }
    .textDisplay {
      font-size: 16px; line-height: 1.6; padding: 8px; border-radius: 6px;
    }
    /* Fullscreen mode: enable scrolling */
    .container.fullscreen .textDisplay {
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    .spoken { color: var(--color-text-primary); }
    .pending { color: var(--color-text-secondary); }
    /* Word-level states for click-to-jump */
    .word { cursor: pointer; transition: color 0.15s, opacity 0.15s, background 0.15s; }
    .word-spoken { color: var(--color-text-primary); }
    .word-current { color: var(--color-text-primary); font-weight: 600; }
    .word-pending { color: var(--color-text-secondary); }
    .word-unavailable { color: var(--color-text-secondary); opacity: 0.5; }
    .word-target { background: rgba(255, 200, 0, 0.3); border-radius: 2px; }
    /* Shimmer animation for loading region */
    @keyframes shimmer-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.9; }
    }
    .word-loading { animation: shimmer-pulse 1s ease-in-out infinite; }
    .word-loading.phase-0 { animation-delay: 0s; }
    .word-loading.phase-1 { animation-delay: 0.1s; }
    .word-loading.phase-2 { animation-delay: 0.15s; }
    .word-loading.phase-3 { animation-delay: 0.2s; }
    .word-loading.phase-4 { animation-delay: 0.25s; }
    /* Toolbar - top right, visible on hover */
    .toolbar {
      position: absolute;
      top: 8px; right: 8px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 10;
    }
    .container:hover .toolbar { opacity: 0.8; }
    .toolbar:hover { opacity: 1; }
    .controlBtn {
      width: 32px; height: 32px; border: none; border-radius: 6px;
      background: rgba(0, 0, 0, 0.5); color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
      font-size: 14px;
    }
    .controlBtn:hover { background: rgba(0, 0, 0, 0.8); }
    .controlBtn svg { width: 16px; height: 16px; }
    .fullscreenBtn { display: none; }
    .fullscreenBtn.available { display: flex; }
    .fullscreenBtn .collapseIcon { display: none; }
    .container.fullscreen .fullscreenBtn .expandIcon { display: none; }
    .container.fullscreen .fullscreenBtn .collapseIcon { display: block; }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-text-primary: #eee;
        --color-text-secondary: #666;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
    import React, { useState, useCallback, useEffect, useRef, StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useApp } from '@modelcontextprotocol/ext-apps/react';

    function SayWidget() {
      const [hostContext, setHostContext] = useState(undefined);
      const [displayText, setDisplayText] = useState("");
      const [charPosition, setCharPosition] = useState(0);
      const [status, setStatus] = useState("idle"); // idle | playing | paused | finished
      const [hasPendingChunks, setHasPendingChunks] = useState(false);
      const [displayMode, setDisplayMode] = useState("inline");
      const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
      const [autoPlay, setAutoPlay] = useState(true); // Default to autoPlay, can be overridden by tool input

      const voiceRef = useRef("cosette"); // Current voice, updated from tool input
      const queueIdRef = useRef(null);
      const audioContextRef = useRef(null);
      const sampleRateRef = useRef(24000);
      const nextPlayTimeRef = useRef(0);
      const playbackStartTimeRef = useRef(0);
      const chunkTimingsRef = useRef([]);
      const pendingChunksRef = useRef([]);
      const allAudioReceivedRef = useRef(false);
      const isPollingRef = useRef(false);
      const lastTextRef = useRef("");
      const fullTextRef = useRef("");
      const progressIntervalRef = useRef(null);
      const appRef = useRef(null);
      const lastModelContextUpdateRef = useRef(0);
      const audioOperationInProgressRef = useRef(false);
      const initQueuePromiseRef = useRef(null);
      const pendingModelContextUpdateRef = useRef(null);
      // Click-to-jump: audio accumulation and seek state
      const accumulatedSamplesRef = useRef([]);  // Array of Float32Array chunks
      const totalSamplesRef = useRef(0);
      const audioAvailableUpToCharRef = useRef(0);
      const activeSourcesRef = useRef([]);  // Track scheduled sources for cancellation
      const seekSourceRef = useRef(null);  // Source for seek playback
      const seekStartTimeRef = useRef(0);  // AudioContext time when seek playback started
      const seekAudioOffsetRef = useRef(0);  // Audio time offset for seek
      const [pendingJumpTarget, setPendingJumpTarget] = useState(null);  // Character position waiting for audio

      // Split text into words with character positions
      const splitIntoWords = useCallback((text) => {
        const words = [];
        let charPos = 0;
        for (const match of text.matchAll(/(\\S+)(\\s*)/g)) {
          words.push({
            word: match[1],
            whitespace: match[2],
            charStart: charPos,
            charEnd: charPos + match[1].length,
          });
          charPos += match[0].length;
        }
        return words;
      }, []);

      // Determine CSS class for a word based on playback state
      const getWordClass = useCallback((wordInfo, currentCharPos, audioAvailableUpTo, jumpTarget) => {
        const { charStart, charEnd } = wordInfo;
        const classes = ["word"];

        // Target word (where user clicked)
        if (jumpTarget !== null && charStart <= jumpTarget && charEnd > jumpTarget) {
          classes.push("word-target");
        }

        // Determine state based on position
        if (charEnd <= currentCharPos) {
          classes.push("word-spoken");
        } else if (charStart <= currentCharPos && charEnd > currentCharPos) {
          classes.push("word-current");
        } else if (charEnd <= audioAvailableUpTo) {
          classes.push("word-pending");
        } else {
          classes.push("word-unavailable");
          // Show shimmer for words between current and jump target
          if (jumpTarget !== null && charStart < jumpTarget && charEnd > currentCharPos) {
            const wordIndex = Math.floor(charStart / 10);  // Approximate word index
            classes.push("word-loading", `phase-${wordIndex % 5}`);
          }
        }
        return classes.join(" ");
      }, []);

      // Inverse lookup: character position -> audio time
      const charToAudioTime = useCallback((charPos) => {
        const timings = chunkTimingsRef.current;
        for (const chunk of timings) {
          if (charPos >= chunk.charStart && charPos < chunk.charEnd) {
            const progress = (charPos - chunk.charStart) / (chunk.charEnd - chunk.charStart);
            // Return time relative to playbackStartTimeRef
            return (chunk.audioStartTime - playbackStartTimeRef.current) +
                   progress * (chunk.audioEndTime - chunk.audioStartTime);
          }
        }
        // If before first chunk
        if (timings.length > 0 && charPos < timings[0].charStart) {
          return 0;
        }
        // If after last chunk
        if (timings.length > 0) {
          const last = timings[timings.length - 1];
          if (charPos >= last.charEnd) {
            return last.audioEndTime - playbackStartTimeRef.current;
          }
        }
        return null;  // No audio data yet
      }, []);

      const roundToWordEnd = useCallback((pos) => {
        const text = lastTextRef.current;
        if (pos >= text.length) return text.length;
        if (pos <= 0) return 0;
        if (text[pos] === " " || text[pos] === "\\n") return pos;
        let end = pos;
        while (end < text.length && text[end] !== " " && text[end] !== "\\n") end++;
        return end;
      }, []);

      const getCharacterPosition = useCallback((currentTime) => {
        const timings = chunkTimingsRef.current;
        let rawPos = 0;

        // If we're playing from a seek position, adjust the time calculation
        let effectiveAudioTime;
        if (seekStartTimeRef.current > 0 && seekAudioOffsetRef.current > 0) {
          // Calculate effective audio time based on seek offset
          effectiveAudioTime = seekAudioOffsetRef.current + (currentTime - seekStartTimeRef.current);
        } else {
          effectiveAudioTime = currentTime - playbackStartTimeRef.current;
        }

        if (timings.length === 0) {
          rawPos = Math.floor(effectiveAudioTime * 12);
        } else {
          // Find character position based on effective audio time
          for (const chunk of timings) {
            const chunkStartRelative = chunk.audioStartTime - playbackStartTimeRef.current;
            const chunkEndRelative = chunk.audioEndTime - playbackStartTimeRef.current;
            if (effectiveAudioTime >= chunkStartRelative && effectiveAudioTime < chunkEndRelative) {
              const duration = chunkEndRelative - chunkStartRelative;
              if (duration <= 0) { rawPos = chunk.charStart; }
              else {
                const progress = (effectiveAudioTime - chunkStartRelative) / duration;
                rawPos = Math.floor(chunk.charStart + progress * (chunk.charEnd - chunk.charStart));
              }
              break;
            }
          }
          if (rawPos === 0 && timings.length > 0) {
            const firstChunkStart = timings[0].audioStartTime - playbackStartTimeRef.current;
            if (effectiveAudioTime < firstChunkStart) rawPos = 0;
            else {
              const last = timings[timings.length - 1];
              const lastChunkEnd = last.audioEndTime - playbackStartTimeRef.current;
              if (effectiveAudioTime >= lastChunkEnd) rawPos = last.charEnd;
            }
          }
        }
        return roundToWordEnd(rawPos);
      }, [roundToWordEnd]);

      const finishPlayback = useCallback(() => {
        setStatus("finished");
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setCharPosition(lastTextRef.current.length);
      }, []);

      const startProgressTracking = useCallback(() => {
        if (progressIntervalRef.current) return;
        progressIntervalRef.current = setInterval(() => {
          const ctx = audioContextRef.current;
          if (!ctx) return;
          setCharPosition(getCharacterPosition(ctx.currentTime));
          if (allAudioReceivedRef.current && ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
            finishPlayback();
          }
        }, 50);
      }, [getCharacterPosition, finishPlayback]);

      const scheduleAudioChunkInternal = useCallback(async (chunk) => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        const binaryString = atob(chunk.audio_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768;

        // Accumulate audio for seek functionality
        accumulatedSamplesRef.current.push(float32Array.slice());
        totalSamplesRef.current += float32Array.length;
        audioAvailableUpToCharRef.current = chunk.char_end;

        const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRateRef.current);
        audioBuffer.getChannelData(0).set(float32Array);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
        const duration = audioBuffer.duration;
        if (chunkTimingsRef.current.length === 0) {
          playbackStartTimeRef.current = startTime;
          setStatus("playing");
          startProgressTracking();
        }
        source.start(startTime);
        nextPlayTimeRef.current = startTime + duration;
        chunkTimingsRef.current.push({
          charStart: chunk.char_start, charEnd: chunk.char_end,
          audioStartTime: startTime, audioEndTime: nextPlayTimeRef.current,
        });

        // Track source for potential cancellation during seek
        activeSourcesRef.current.push({ source, endTime: nextPlayTimeRef.current });
        // Clean up old sources that have finished
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s.endTime > ctx.currentTime);

        const thisBufferEndTime = nextPlayTimeRef.current;
        source.onended = () => {
          if (!audioContextRef.current) return;
          const ct = audioContextRef.current.currentTime;
          if (allAudioReceivedRef.current && thisBufferEndTime >= nextPlayTimeRef.current - 0.01 && ct >= nextPlayTimeRef.current - 0.05) {
            finishPlayback();
          }
        };
      }, [startProgressTracking, finishPlayback]);

      const scheduleAudioChunk = useCallback(async (chunk) => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        // Only defer to pendingChunks if suspended AND playback hasn't started yet
        // (i.e., autoplay is blocked). If we're paused by user (chunkTimings exists),
        // schedule normally - the audio will queue up and play when resumed.
        if (ctx.state === "suspended" && chunkTimingsRef.current.length === 0) {
          pendingChunksRef.current.push(chunk);
          setHasPendingChunks(true);
          return;
        }
        await scheduleAudioChunkInternal(chunk);

        // Check if we have a pending jump target that's now available
        // Note: pendingJumpTarget is accessed via closure, need to use ref for real-time check
        // Actually React state is not accessible in useCallback without dependency, so we'll handle this in useEffect
      }, [scheduleAudioChunkInternal]);

      // Stop all scheduled audio sources (for seek)
      const stopAllScheduledSources = useCallback(() => {
        for (const { source } of activeSourcesRef.current) {
          try { source.stop(); } catch {}
        }
        activeSourcesRef.current = [];
        if (seekSourceRef.current) {
          try { seekSourceRef.current.stop(); } catch {}
          seekSourceRef.current = null;
        }
      }, []);

      // Seek to a character position (creates new source from accumulated audio)
      const seekToCharPosition = useCallback(async (charPos) => {
        const ctx = audioContextRef.current;
        if (!ctx) return false;

        // Find audio time for character position
        const targetTime = charToAudioTime(charPos);
        if (targetTime === null) return false;  // No audio for this position

        // Calculate sample offset
        const sampleOffset = Math.floor(targetTime * sampleRateRef.current);
        if (sampleOffset < 0 || sampleOffset >= totalSamplesRef.current) return false;

        // Stop all currently scheduled sources
        stopAllScheduledSources();

        // Combine accumulated samples into single buffer
        const totalLength = totalSamplesRef.current;
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of accumulatedSamplesRef.current) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        // Create new buffer starting at offset
        const remainingLength = totalLength - sampleOffset;
        if (remainingLength <= 0) return false;

        const buffer = ctx.createBuffer(1, remainingLength, sampleRateRef.current);
        buffer.getChannelData(0).set(combined.subarray(sampleOffset));

        // Create source but don't start yet (will start on resume)
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        seekSourceRef.current = source;
        seekAudioOffsetRef.current = targetTime;

        // Update character position and pause
        setCharPosition(charPos);
        setPendingJumpTarget(null);
        setStatus("paused");
        await ctx.suspend();

        return true;
      }, [charToAudioTime, stopAllScheduledSources]);

      const startPolling = useCallback(async () => {
        const app = appRef.current;
        if (isPollingRef.current || !app) return;
        isPollingRef.current = true;
        while (queueIdRef.current) {
          try {
            const result = await app.callServerTool({ name: "poll_tts_audio", arguments: { queue_id: queueIdRef.current } });
            const data = JSON.parse(result.content[0].text);
            if (data.error) break;
            for (const chunk of data.chunks) await scheduleAudioChunk(chunk);
            if (data.done) { allAudioReceivedRef.current = true; break; }
            await new Promise(r => setTimeout(r, data.chunks.length > 0 ? 30 : 80));
          } catch (err) { break; }
        }
        isPollingRef.current = false;
      }, [scheduleAudioChunk]);

      const cancelCurrentQueue = useCallback(async () => {
        const app = appRef.current;
        if (queueIdRef.current && app) {
          try { await app.callServerTool({ name: "cancel_tts_queue", arguments: { queue_id: queueIdRef.current } }); }
          catch (err) {}
        }
      }, []);

      const initTTSQueue = useCallback(async () => {
        console.log('[TTS] initTTSQueue called, queueIdRef:', queueIdRef.current);
        // Already initialized
        if (queueIdRef.current) { console.log('[TTS] already initialized'); return true; }
        // Wait for in-progress initialization
        if (initQueuePromiseRef.current) {
          await initQueuePromiseRef.current;
          return !!queueIdRef.current;
        }
        const app = appRef.current;
        if (!app) return false;
        // Start initialization with promise lock
        initQueuePromiseRef.current = (async () => {
          try {
            // Close any existing audio context from previous session
            if (audioContextRef.current) {
              try { await audioContextRef.current.close(); } catch {}
              audioContextRef.current = null;
            }
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            // Reset state for new session
            chunkTimingsRef.current = [];
            pendingChunksRef.current = [];
            allAudioReceivedRef.current = false;
            // Reset click-to-jump state
            accumulatedSamplesRef.current = [];
            totalSamplesRef.current = 0;
            audioAvailableUpToCharRef.current = 0;
            activeSourcesRef.current = [];
            seekSourceRef.current = null;
            seekStartTimeRef.current = 0;
            seekAudioOffsetRef.current = 0;
            setPendingJumpTarget(null);
            setCharPosition(0);
            setStatus("idle");
            // Create new queue
            console.log('[TTS] creating new queue');
            const result = await app.callServerTool({ name: "create_tts_queue", arguments: { voice: voiceRef.current } });
            const data = JSON.parse(result.content[0].text);
            if (data.error) { console.log('[TTS] queue creation error:', data.error); return false; }
            queueIdRef.current = data.queue_id;
            sampleRateRef.current = data.sample_rate || 24000;
            console.log('[TTS] creating new AudioContext');
            audioContextRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
            nextPlayTimeRef.current = 0;
            startPolling();
            return true;
          } catch (err) { return false; }
          finally { initQueuePromiseRef.current = null; }
        })();
        return initQueuePromiseRef.current;
      }, [startPolling]);

      const sendTextToTTS = useCallback(async (text) => {
        const app = appRef.current;
        if (!queueIdRef.current || !app) return;
        if (text.length > lastTextRef.current.length) {
          const diff = text.slice(lastTextRef.current.length);
          lastTextRef.current = text;
          try { await app.callServerTool({ name: "add_tts_text", arguments: { queue_id: queueIdRef.current, text: diff } }); }
          catch (err) {}
        }
      }, []);

      const ensureAudioContextResumed = useCallback(async () => {
        const ctx = audioContextRef.current;
        if (ctx && ctx.state === "suspended") {
          await ctx.resume();
          if (pendingChunksRef.current.length > 0) {
            // This is only reached during initial autoplay unblocking (before any audio played).
            // Reset nextPlayTimeRef to current time so chunks start immediately.
            nextPlayTimeRef.current = ctx.currentTime;
            const chunks = pendingChunksRef.current;
            pendingChunksRef.current = [];
            setHasPendingChunks(false);
            for (const chunk of chunks) await scheduleAudioChunkInternal(chunk);
          }
        }
      }, [scheduleAudioChunkInternal]);

      const restartPlayback = useCallback(async () => {
        console.log('[TTS] restartPlayback called');
        // Prevent concurrent audio operations
        if (audioOperationInProgressRef.current) { console.log('[TTS] restartPlayback blocked'); return; }
        audioOperationInProgressRef.current = true;
        try {
          if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
          await cancelCurrentQueue();
          if (audioContextRef.current) { await audioContextRef.current.close(); audioContextRef.current = null; }
          const textToReplay = fullTextRef.current || lastTextRef.current;
          if (!textToReplay) return;
          queueIdRef.current = null; lastTextRef.current = ""; isPollingRef.current = false;
          nextPlayTimeRef.current = 0; playbackStartTimeRef.current = 0;
          setStatus("idle"); chunkTimingsRef.current = []; allAudioReceivedRef.current = false;
          setCharPosition(0); pendingChunksRef.current = []; setHasPendingChunks(false);
          // Reset click-to-jump state
          accumulatedSamplesRef.current = []; totalSamplesRef.current = 0;
          audioAvailableUpToCharRef.current = 0; activeSourcesRef.current = [];
          seekSourceRef.current = null; seekStartTimeRef.current = 0; seekAudioOffsetRef.current = 0;
          setPendingJumpTarget(null);
          setDisplayText(textToReplay);
          const app = appRef.current;
          if (!app) return;
          const result = await app.callServerTool({ name: "create_tts_queue", arguments: { voice: voiceRef.current } });
          const data = JSON.parse(result.content[0].text);
          if (data.error) return;
          queueIdRef.current = data.queue_id;
          sampleRateRef.current = data.sample_rate || 24000;
          audioContextRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
          nextPlayTimeRef.current = 0;
          await app.callServerTool({ name: "add_tts_text", arguments: { queue_id: queueIdRef.current, text: textToReplay } });
          lastTextRef.current = textToReplay;
          await app.callServerTool({ name: "end_tts_queue", arguments: { queue_id: queueIdRef.current } });
          startPolling();
        } catch (err) {
        } finally {
          audioOperationInProgressRef.current = false;
        }
      }, [cancelCurrentQueue, startPolling]);

      const togglePlayPause = useCallback(async () => {
        console.log('[TTS] togglePlayPause called, status:', status, 'ctx:', audioContextRef.current?.state);
        // Prevent concurrent audio operations
        if (audioOperationInProgressRef.current) { console.log('[TTS] blocked by audioOpInProgress'); return; }
        let ctx = audioContextRef.current;
        try {
          if (status === "finished") { console.log('[TTS] finished, calling restartPlayback'); await restartPlayback(); return; }
          // If no context yet, wait for init to complete (up to 3s)
          if (!ctx) {
            console.log('[TTS] no ctx, waiting for init');
            for (let i = 0; i < 30 && !audioContextRef.current; i++) {
              await new Promise(r => setTimeout(r, 100));
            }
            ctx = audioContextRef.current;
            if (!ctx) { console.log('[TTS] still no ctx, giving up'); return; }
          }
          if (ctx.state === "suspended" || pendingChunksRef.current.length > 0) {
            console.log('[TTS] resuming via ensureAudioContextResumed');
            // If we have a seek source ready, start it now
            if (seekSourceRef.current) {
              await ctx.resume();
              const source = seekSourceRef.current;
              seekSourceRef.current = null;
              seekStartTimeRef.current = ctx.currentTime;
              source.start(ctx.currentTime);
              // Update nextPlayTimeRef for progress tracking
              const remainingDuration = source.buffer.duration;
              nextPlayTimeRef.current = ctx.currentTime + remainingDuration;
              // Handle end of seek playback
              source.onended = () => {
                if (!audioContextRef.current) return;
                // Clear seek refs and mark as finished
                seekStartTimeRef.current = 0;
                seekAudioOffsetRef.current = 0;
                if (allAudioReceivedRef.current) {
                  finishPlayback();
                }
              };
              setStatus("playing");
              startProgressTracking();
              return;
            }
            await ensureAudioContextResumed(); setStatus("playing"); return;
          }
          if (status === "paused") { console.log('[TTS] resuming paused'); await ctx.resume(); setStatus("playing"); }
          else if (status === "playing") { console.log('[TTS] pausing'); await ctx.suspend(); setStatus("paused"); }
        } catch (err) { console.error('[TTS] togglePlayPause error:', err); }
      }, [status, restartPlayback, ensureAudioContextResumed, startProgressTracking]);

      // Handle word click for jump-to-position
      const handleWordClick = useCallback(async (charStart, e) => {
        e.stopPropagation();  // Prevent container click

        // If finished, restart and seek
        if (status === "finished") {
          // For simplicity, restart then seek
          await restartPlayback();
          return;
        }

        // If already paused near this position, resume instead of seeking
        if (status === "paused" && Math.abs(charPosition - charStart) < 5) {
          await togglePlayPause();
          return;
        }

        // Check if audio is available for this position
        if (charStart <= audioAvailableUpToCharRef.current) {
          // Seek immediately
          await seekToCharPosition(charStart);
        } else {
          // Set pending target, show shimmer, wait for audio
          setPendingJumpTarget(charStart);
          setStatus("paused");
          if (audioContextRef.current) {
            await audioContextRef.current.suspend();
          }
          // Will auto-seek when audio arrives (checked in scheduleAudioChunk)
        }
      }, [status, charPosition, seekToCharPosition, togglePlayPause, restartPlayback]);

      const toggleFullscreen = useCallback(async () => {
        const app = appRef.current;
        if (!app) return;
        const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
        try {
          const result = await app.requestDisplayMode({ mode: newMode });
          setDisplayMode(result.mode);
        } catch (err) {}
      }, [displayMode]);

      const { app, error } = useApp({
        appInfo: { name: "Say Widget", version: "1.0.0" },
        capabilities: {},
        onHostContextChanged: (ctx) => {
          if (ctx.availableDisplayModes?.includes("fullscreen")) {
            setFullscreenAvailable(true);
          }
          if (ctx.displayMode) {
            setDisplayMode(ctx.displayMode);
          }
        },
        onAppCreated: (app) => {
          appRef.current = app;
          app.ontoolinputpartial = async (params) => {
            console.log('[TTS] ontoolinputpartial called');
            const newText = params.arguments?.text;
            if (!newText) return;
            // Detect new session: text doesn't continue from where we left off
            const isNewSession = lastTextRef.current.length > 0 && !newText.startsWith(lastTextRef.current);
            if (isNewSession) console.log('[TTS] new session detected in partial');
            if (isNewSession) {
              // Reset for new session
              queueIdRef.current = null;
              lastTextRef.current = "";
            }
            setDisplayText(newText);
            if (!queueIdRef.current && !(await initTTSQueue())) return;
            await sendTextToTTS(newText);
          };
          app.ontoolinput = async (params) => {
            console.log('[TTS] ontoolinput called');
            const text = params.arguments?.text;
            if (!text) return;
            // Read voice setting (defaults to cosette)
            const voice = params.arguments?.voice || "cosette";
            voiceRef.current = voice;
            // Read autoPlay setting (defaults to true, but browser may block autoplay)
            const shouldAutoPlay = params.arguments?.autoPlay !== false;
            setAutoPlay(shouldAutoPlay);
            // Detect new session: text doesn't continue from where we left off
            const isNewSession = lastTextRef.current.length > 0 && !text.startsWith(lastTextRef.current);
            if (isNewSession) console.log('[TTS] new session detected in input');
            if (isNewSession) {
              queueIdRef.current = null;
              lastTextRef.current = "";
            }
            setDisplayText(text);
            if (!queueIdRef.current && !(await initTTSQueue())) return;
            await sendTextToTTS(text);
          };
          app.ontoolresult = async () => {
            fullTextRef.current = lastTextRef.current;
            if (queueIdRef.current) {
              try { await app.callServerTool({ name: "end_tts_queue", arguments: { queue_id: queueIdRef.current } }); }
              catch (err) {}
            }
            // DON'T reset here - let audio continue playing
            // New session detection happens in ontoolinputpartial via text comparison
          };
          app.onteardown = async () => {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            await cancelCurrentQueue();
            if (audioContextRef.current) { await audioContextRef.current.close(); audioContextRef.current = null; }
            return {};
          };
          app.onhostcontextchanged = (params) => {
            setHostContext(prev => ({ ...prev, ...params }));
            // Sync displayMode when host changes it (e.g., user exits fullscreen via host UI)
            if (params.displayMode) {
              setDisplayMode(params.displayMode);
            }
          };
        },
      });

      useEffect(() => {
        if (!app) return;
        const ctx = app.getHostContext();
        setHostContext(ctx);
        if (ctx?.availableDisplayModes?.includes("fullscreen")) {
          setFullscreenAvailable(true);
        }
        if (ctx?.displayMode) {
          setDisplayMode(ctx.displayMode);
        }
      }, [app]);

      useEffect(() => {
        if (!app || !displayText || status === "idle") return;
        const caps = app.getHostCapabilities();
        if (!caps?.updateModelContext) return;
        const now = Date.now();
        const timeSince = now - lastModelContextUpdateRef.current;
        const DEBOUNCE_MS = 2000;
        const doUpdate = () => {
          lastModelContextUpdateRef.current = Date.now();
          pendingModelContextUpdateRef.current = null;
          const snippetStart = Math.max(0, charPosition - 30);
          const snippetEnd = Math.min(displayText.length, charPosition + 10);
          const snippet = `...` + displayText.slice(snippetStart, charPosition) + `█` + displayText.slice(charPosition, snippetEnd) + `...`;
          let statusText;
          if (status === "finished") statusText = `Finished playing ` + displayText.length + ` chars.`;
          else if (status === "paused") statusText = `PAUSED at "` + snippet + `" (` + charPosition + `/` + displayText.length + `)`;
          else statusText = `Playing: "` + snippet + `" (` + charPosition + `/` + displayText.length + `)`;
          app.updateModelContext({ content: [{ type: "text", text: statusText }] }).catch(() => {});
        };
        if (pendingModelContextUpdateRef.current) { clearTimeout(pendingModelContextUpdateRef.current); pendingModelContextUpdateRef.current = null; }
        if (timeSince >= DEBOUNCE_MS) doUpdate();
        else pendingModelContextUpdateRef.current = setTimeout(doUpdate, DEBOUNCE_MS - timeSince);
        return () => { if (pendingModelContextUpdateRef.current) clearTimeout(pendingModelContextUpdateRef.current); };
      }, [app, status, charPosition, displayText]);

      // Auto-jump when audio arrives for pending jump target
      // We track audioAvailableUpToChar via a state that updates when chunks arrive
      const [audioAvailableUpToChar, setAudioAvailableUpToChar] = useState(0);

      // Update audioAvailableUpToChar state when ref changes (polled in scheduleAudioChunkInternal)
      useEffect(() => {
        const checkInterval = setInterval(() => {
          if (audioAvailableUpToCharRef.current !== audioAvailableUpToChar) {
            setAudioAvailableUpToChar(audioAvailableUpToCharRef.current);
          }
        }, 100);
        return () => clearInterval(checkInterval);
      }, [audioAvailableUpToChar]);

      // Auto-jump when pending target becomes available
      useEffect(() => {
        if (pendingJumpTarget !== null && audioAvailableUpToChar >= pendingJumpTarget) {
          seekToCharPosition(pendingJumpTarget);
        }
      }, [pendingJumpTarget, audioAvailableUpToChar, seekToCharPosition]);

      if (error) return <div><strong>ERROR:</strong> {error.message}</div>;
      if (!app) return <div>Connecting...</div>;

      // Split text into words for click-to-jump
      const words = splitIntoWords(displayText);

      return (
        <main className={`container` + (displayMode === "fullscreen" ? ` fullscreen` : ``)} style={{
          paddingTop: hostContext?.safeAreaInsets?.top,
          paddingRight: hostContext?.safeAreaInsets?.right,
          paddingBottom: hostContext?.safeAreaInsets?.bottom,
          paddingLeft: hostContext?.safeAreaInsets?.left,
        }}>
          <div className="textWrapper">
            <div className="textDisplay" style={{cursor: "pointer"}}>
              {words.map((w, i) => (
                <span key={i}>
                  <span
                    className={getWordClass(w, charPosition, audioAvailableUpToChar, pendingJumpTarget)}
                    onClick={(e) => handleWordClick(w.charStart, e)}
                  >
                    {w.word}
                  </span>
                  {w.whitespace}
                </span>
              ))}
            </div>
          </div>
          {/* Toolbar - top right */}
          <div className="toolbar">
            <button className="controlBtn" onClick={togglePlayPause} title="Play/Pause">
              {status === "playing" ? "⏸️" : status === "finished" ? "🔄" : "▶️"}
            </button>
            <button className="controlBtn" onClick={restartPlayback} title="Restart">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
            <button className={`controlBtn fullscreenBtn` + (fullscreenAvailable ? ` available` : ``)} onClick={toggleFullscreen} title="Toggle fullscreen">
              <svg className="expandIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              <svg className="collapseIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </button>
          </div>
        </main>
      );
    }

    createRoot(document.getElementById('root')).render(<StrictMode><SayWidget /></StrictMode>);
  </script>
</body>
</html>"""


def get_widget_html() -> str:
    """Get the widget HTML, preferring built version from dist/."""
    # Prefer built version from dist/ (local development with npm run build)
    dist_path = Path(__file__).parent / "dist" / "mcp-app.html"
    if dist_path.exists():
        return dist_path.read_text()
    # Fallback to embedded widget (for `uv run <url>` or unbundled usage)
    return EMBEDDED_WIDGET_HTML


# IMPORTANT: all the external domains used by app must be listed
# in the meta.ui.csp.resourceDomains - otherwise they will be blocked by CSP policy
@mcp.resource(
    WIDGET_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://esm.sh", "https://unpkg.com"]}}},
)
def widget() -> str:
    """Widget HTML resource with CSP metadata for external dependencies."""
    return get_widget_html()


# ------------------------------------------------------
# Startup
# ------------------------------------------------------

def load_tts_model():
    """Load the TTS model on startup."""
    global tts_model
    logger.info("Loading TTS model...")
    tts_model = TTSModel.load_model()
    logger.info("TTS model loaded")


def create_app():
    """Create the ASGI app (for uvicorn reload mode)."""
    load_tts_model()
    app = mcp.streamable_http_app(stateless_http=True)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    if "--stdio" in sys.argv:
        # Claude Desktop mode
        load_tts_model()
        mcp.run(transport="stdio")
    elif "--reload" in sys.argv:
        # Reload mode - pass app as string so uvicorn can reimport
        print(f"Say Server listening on http://{HOST}:{PORT}/mcp (reload mode)")
        uvicorn.run("server:create_app", host=HOST, port=PORT, reload=True, factory=True)
    else:
        # HTTP mode
        app = create_app()
        print(f"Say Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)
