/**
 * Unified Voice I/O hook combining STT (Speech-to-Text) and VAD (Voice Activity Detection).
 * Adapted from voice-assist project.
 *
 * Two modes:
 * - 'listening': Active STT transcription (when user should speak)
 * - 'detecting': VAD only for barge-in detection (during TTS playback)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";

interface UseVoiceIOOptions {
  onFinalResult: (text: string) => void;
  onBargeIn: () => void;
  silenceTimeoutMs?: number;
  bargeInDurationMs?: number;
}

interface UseVoiceIOReturn {
  isListening: boolean;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  micLevel: number; // 0-1 audio level for visualization
  isMicMuted: boolean;
  start: () => Promise<void>;
  stop: () => void;
  setMode: (mode: "listening" | "detecting") => void;
  recalibrate: () => void;
  setMicMuted: (muted: boolean) => void;
}

// SpeechRecognition types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const SpeechRecognition: SpeechRecognitionConstructor | null =
  typeof window !== "undefined"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    : null;

export function useVoiceIO(options: UseVoiceIOOptions): UseVoiceIOReturn {
  const {
    onFinalResult,
    onBargeIn,
    silenceTimeoutMs = 1500,
    bargeInDurationMs = 400,
  } = options;

  // State
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Refs
  const modeRef = useRef<"listening" | "detecting" | "off">("off");
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldBeActiveRef = useRef(false);

  // VAD refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const levelAnimationFrameRef = useRef<number | null>(null);
  const voiceStartTimeRef = useRef<number | null>(null);
  const baselineLevelRef = useRef(0);
  const calibrationCountRef = useRef(0);
  const hasTriggeredBargeInRef = useRef(false);
  const isMicMutedRef = useRef(false);

  // Callback refs
  const onFinalResultRef = useRef(onFinalResult);
  const onBargeInRef = useRef(onBargeIn);

  useEffect(() => {
    onFinalResultRef.current = onFinalResult;
    onBargeInRef.current = onBargeIn;
  }, [onFinalResult, onBargeIn]);

  // Clear silence timer
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Mic level monitoring loop
  const monitorMicLevel = useCallback(() => {
    if (!shouldBeActiveRef.current || !analyserRef.current) {
      levelAnimationFrameRef.current = null;
      setMicLevel(0);
      return;
    }

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const average =
      dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;

    setMicLevel(isMicMutedRef.current ? 0 : Math.min(1, average * 3));

    levelAnimationFrameRef.current = requestAnimationFrame(monitorMicLevel);
  }, []);

  // VAD analysis loop with adaptive baseline
  const analyzeAudio = useCallback(() => {
    if (modeRef.current !== "detecting") {
      animationFrameRef.current = null;
      return;
    }
    if (!analyserRef.current || isMicMutedRef.current) {
      animationFrameRef.current = null;
      return;
    }

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const average =
      dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;

    const CALIBRATION_SAMPLES = 15;
    const THRESHOLD_MULTIPLIER = 1.8;
    const ADAPTIVE_ALPHA = 0.02;

    if (calibrationCountRef.current < CALIBRATION_SAMPLES) {
      calibrationCountRef.current++;
      if (calibrationCountRef.current === 1) {
        baselineLevelRef.current = average;
      } else {
        baselineLevelRef.current +=
          (average - baselineLevelRef.current) / calibrationCountRef.current;
      }
    } else if (!hasTriggeredBargeInRef.current) {
      const threshold = Math.max(
        0.15,
        baselineLevelRef.current * THRESHOLD_MULTIPLIER,
      );

      if (average > threshold) {
        if (!voiceStartTimeRef.current) {
          voiceStartTimeRef.current = Date.now();
        } else if (Date.now() - voiceStartTimeRef.current > bargeInDurationMs) {
          hasTriggeredBargeInRef.current = true;
          onBargeInRef.current();
        }
      } else {
        voiceStartTimeRef.current = null;
        baselineLevelRef.current =
          baselineLevelRef.current * (1 - ADAPTIVE_ALPHA) +
          average * ADAPTIVE_ALPHA;
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, [bargeInDurationMs]);

  // Start VAD analysis
  const startVAD = useCallback(() => {
    if (!audioContextRef.current || !streamRef.current) return;

    calibrationCountRef.current = 0;
    baselineLevelRef.current = 0;
    hasTriggeredBargeInRef.current = false;
    voiceStartTimeRef.current = null;

    if (!analyserRef.current) {
      const source = audioContextRef.current.createMediaStreamSource(
        streamRef.current,
      );
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;
    }

    analyzeAudio();
  }, [analyzeAudio]);

  // Stop VAD analysis
  const stopVAD = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Force recalibration
  const recalibrate = useCallback(() => {
    if (modeRef.current === "detecting") {
      calibrationCountRef.current = 0;
      baselineLevelRef.current = 0;
      hasTriggeredBargeInRef.current = false;
      voiceStartTimeRef.current = null;
    }
  }, []);

  // Create STT recognition instance
  const createRecognition = useCallback(() => {
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);

      if (shouldBeActiveRef.current && modeRef.current === "listening") {
        setTimeout(() => {
          if (
            shouldBeActiveRef.current &&
            modeRef.current === "listening" &&
            recognitionRef.current
          ) {
            try {
              recognitionRef.current.start();
            } catch {
              // Ignore start errors
            }
          }
        }, 300);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.error("[VoiceIO] STT error:", event.error);
      if (event.error === "not-allowed") {
        setError("Microphone access denied");
      }
    };

    recognition.onresult = (event) => {
      if (modeRef.current !== "listening") return;

      clearSilenceTimer();

      let newFinal = "";
      let newInterim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinal += result[0].transcript;
        } else {
          newInterim += result[0].transcript;
        }
      }

      setFinalTranscript(newFinal);
      setInterimTranscript(newInterim);

      if (newFinal.trim()) {
        silenceTimerRef.current = setTimeout(() => {
          onFinalResultRef.current(newFinal.trim());
          setFinalTranscript("");
          setInterimTranscript("");
        }, silenceTimeoutMs);
      }
    };

    return recognition;
  }, [silenceTimeoutMs, clearSilenceTimer]);

  // Start STT
  const startSTT = useCallback(() => {
    if (recognitionRef.current) return;

    recognitionRef.current = createRecognition();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // Ignore start errors
      }
    }
  }, [createRecognition]);

  // Stop STT
  const stopSTT = useCallback(() => {
    clearSilenceTimer();
    setFinalTranscript("");
    setInterimTranscript("");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearSilenceTimer]);

  // Set mode
  const setMode = useCallback(
    (mode: "listening" | "detecting") => {
      if (!shouldBeActiveRef.current) return;
      if (modeRef.current === mode) return;

      modeRef.current = mode;

      if (mode === "listening") {
        stopVAD();
        startSTT();
      } else {
        stopSTT();
        startVAD();
      }
    },
    [startSTT, stopSTT, startVAD, stopVAD],
  );

  // Start everything
  const start = useCallback(async () => {
    if (shouldBeActiveRef.current) return;

    if (!SpeechRecognition) {
      setError("Speech recognition not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      audioContextRef.current = new AudioContext();

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      shouldBeActiveRef.current = true;
      modeRef.current = "listening";

      monitorMicLevel();
      startSTT();
    } catch (e) {
      const err = e as Error & { name: string };
      if (err.name === "NotAllowedError") {
        setError("Microphone permission denied");
      } else {
        setError(`Microphone error: ${err.message}`);
      }
    }
  }, [startSTT, monitorMicLevel]);

  // Stop everything
  const stop = useCallback(() => {
    shouldBeActiveRef.current = false;
    modeRef.current = "off";

    stopSTT();
    stopVAD();

    if (levelAnimationFrameRef.current) {
      cancelAnimationFrame(levelAnimationFrameRef.current);
      levelAnimationFrameRef.current = null;
    }
    setMicLevel(0);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
  }, [stopSTT, stopVAD]);

  // Mic mute control
  const setMicMutedFn = useCallback((muted: boolean) => {
    isMicMutedRef.current = muted;
    setIsMicMuted(muted);
    if (muted) {
      setMicLevel(0);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return useMemo(
    () => ({
      isListening,
      interimTranscript,
      finalTranscript,
      error,
      micLevel,
      isMicMuted,
      start,
      stop,
      setMode,
      recalibrate,
      setMicMuted: setMicMutedFn,
    }),
    [
      isListening,
      interimTranscript,
      finalTranscript,
      error,
      micLevel,
      isMicMuted,
      start,
      stop,
      setMode,
      recalibrate,
      setMicMutedFn,
    ],
  );
}
