/**
 * Text-to-Speech hook with word boundary tracking and resume capability.
 * Adapted from voice-assist project.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface SpeakOptions {
  voice?: SpeechSynthesisVoice | null;
  startFromChar?: number;
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: (completed: boolean, finalCharIndex: number) => void;
}

interface UseSpeechSynthesisReturn {
  speak: (text: string, options?: SpeakOptions) => void;
  stop: () => void;
  isSpeaking: boolean;
  availableVoices: SpeechSynthesisVoice[];
  volume: number;
  setVolume: (v: number) => void;
  isMuted: boolean;
  setMuted: (m: boolean) => void;
}

/**
 * Find word boundary for clean speech resume.
 */
function findWordBoundary(text: string, charIndex: number): number {
  if (charIndex <= 0) return 0;
  if (charIndex >= text.length) return text.length;
  if (text[charIndex] === " ") return charIndex + 1;
  if (charIndex > 0 && text[charIndex - 1] === " ") return charIndex;
  const prevSpace = text.lastIndexOf(" ", charIndex - 1);
  return prevSpace > 0 ? prevSpace + 1 : 0;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);
  const [volume, setVolume] = useState(1);
  const [isMuted, setMuted] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakFromRef = useRef(0);
  const lastCharIndexRef = useRef(0);
  const wasCancelledRef = useRef(false);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);

  // Keep refs in sync
  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  // Load voices
  useEffect(() => {
    const loadVoices = () => {
      if (typeof speechSynthesis === "undefined") return;
      const voices = speechSynthesis.getVoices();
      const englishVoices = voices.filter((v) => v.lang.startsWith("en"));
      const otherVoices = voices.filter((v) => !v.lang.startsWith("en"));
      setAvailableVoices([...englishVoices, ...otherVoices]);
    };

    loadVoices();
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const cleanup = () => {
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
    };

    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, []);

  const speak = useCallback((text: string, options?: SpeakOptions) => {
    if (typeof speechSynthesis === "undefined") return;

    // Cancel any current speech
    wasCancelledRef.current = true;
    speechSynthesis.cancel();
    wasCancelledRef.current = false;

    if (!text.trim()) return;

    const startFrom = options?.startFromChar ?? 0;
    const speakFrom = findWordBoundary(text, startFrom);
    const textToSpeak = text.slice(speakFrom);

    if (!textToSpeak.trim()) return;

    speakFromRef.current = speakFrom;
    lastCharIndexRef.current = speakFrom;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    if (options?.voice) {
      utterance.voice = options.voice;
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = isMutedRef.current ? 0 : volumeRef.current;

    utterance.onstart = () => {
      options?.onStart?.();
    };

    utterance.onboundary = (event) => {
      if (event.name === "word") {
        const absoluteIndex =
          speakFrom + event.charIndex + (event.charLength || 0);
        lastCharIndexRef.current = absoluteIndex;
        options?.onBoundary?.(absoluteIndex);
      }
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      if (!wasCancelledRef.current) {
        options?.onEnd?.(true, text.length);
      }
    };

    utterance.onerror = (event) => {
      setIsSpeaking(false);
      if (event.error === "canceled" || event.error === "interrupted") {
        return;
      }
      console.error("[TTS] Error:", event.error);
      options?.onEnd?.(false, lastCharIndexRef.current);
    };

    utteranceRef.current = utterance;
    setIsSpeaking(true);

    speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if (typeof speechSynthesis === "undefined") return;
    wasCancelledRef.current = true;
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    availableVoices,
    volume,
    setVolume,
    isMuted,
    setMuted,
  };
}
