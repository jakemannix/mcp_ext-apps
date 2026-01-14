/**
 * Voice Assist MCP App
 *
 * A voice-controlled assistant that uses STT, LLM sampling with tools, and TTS.
 */

import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useVoiceIO } from "./hooks/useVoiceIO";
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import { useToolLoop } from "./hooks/useToolLoop";
import styles from "./mcp-app.module.css";
import "./global.css";

const IMPLEMENTATION = { name: "Voice Assist App", version: "1.0.0" };

type AppState = "idle" | "listening" | "thinking" | "speaking";

function VoiceAssistApp() {
  const [hostContext, setHostContext] = useState<
    McpUiHostContext | undefined
  >();
  const { app, error } = useApp({
    appInfo: IMPLEMENTATION,
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.log("[App] Teardown requested");
        return {};
      };
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <strong>Error:</strong> {error.message}
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Connecting...</div>
      </div>
    );
  }

  return <VoiceAssistInner app={app} hostContext={hostContext} />;
}

interface VoiceAssistInnerProps {
  app: App;
  hostContext?: McpUiHostContext;
}

function VoiceAssistInner({ app, hostContext }: VoiceAssistInnerProps) {
  const [appState, setAppState] = useState<AppState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [spokenIndex, setSpokenIndex] = useState(0);

  const appStateRef = useRef(appState);
  appStateRef.current = appState;

  const tts = useSpeechSynthesis();
  const toolLoop = useToolLoop({ app });

  // Handle final speech result
  const handleFinalResult = useCallback(
    async (text: string) => {
      console.log("[App] Final result:", text);
      setTranscript(text);
      setAppState("thinking");
      setResponse("");
      setSpokenIndex(0);

      try {
        const result = await toolLoop.runLoop(text);
        console.log("[App] Tool loop result:", result.answer);
        setResponse(result.answer);
        setAppState("speaking");

        // Start TTS
        tts.speak(result.answer, {
          onStart: () => {
            // Switch to detecting mode for barge-in
            voiceIO.recalibrate();
            voiceIO.setMode("detecting");
          },
          onBoundary: (charIndex) => {
            setSpokenIndex(charIndex);
          },
          onEnd: (completed) => {
            console.log("[App] TTS ended, completed:", completed);
            if (completed && appStateRef.current === "speaking") {
              setAppState("listening");
              voiceIO.setMode("listening");
            }
          },
        });
      } catch (e) {
        console.error("[App] Tool loop error:", e);
        setResponse(`Error: ${(e as Error).message}`);
        setAppState("listening");
        voiceIO.setMode("listening");
      }
    },
    [toolLoop, tts],
  );

  // Handle barge-in (user starts speaking during TTS)
  const handleBargeIn = useCallback(() => {
    console.log("[App] Barge-in detected");
    tts.stop();
    setAppState("listening");
    voiceIO.setMode("listening");
  }, [tts]);

  // Initialize voice IO with callbacks (uses hoisted variable)
  const voiceIO = useVoiceIO({
    onFinalResult: handleFinalResult,
    onBargeIn: handleBargeIn,
  });

  // Handle main button click
  const handleButtonClick = useCallback(async () => {
    if (appState === "idle") {
      await voiceIO.start();
      setAppState("listening");
    } else if (appState === "listening") {
      voiceIO.stop();
      tts.stop();
      setAppState("idle");
    } else if (appState === "speaking") {
      tts.stop();
      setAppState("listening");
      voiceIO.setMode("listening");
    } else if (appState === "thinking") {
      // Can't interrupt thinking easily, just wait
    }
  }, [appState, voiceIO, tts]);

  // Get button label based on state
  const getButtonLabel = () => {
    switch (appState) {
      case "idle":
        return "🎤 Start";
      case "listening":
        return "🎙️ Listening...";
      case "thinking":
        return "🤔 Thinking...";
      case "speaking":
        return "🔊 Speaking...";
    }
  };

  // Get button class based on state
  const getButtonClass = () => {
    return `${styles.mainButton} ${styles[appState]}`;
  };

  return (
    <main
      className={styles.container}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <div className={styles.content}>
        <h1 className={styles.title}>Voice Assistant</h1>

        <button
          className={getButtonClass()}
          onClick={handleButtonClick}
          disabled={appState === "thinking"}
        >
          {getButtonLabel()}
        </button>

        {/* Mic level indicator */}
        {(appState === "listening" || appState === "speaking") && (
          <div className={styles.levelIndicator}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`${styles.levelBar} ${voiceIO.micLevel > i * 0.2 ? styles.active : ""}`}
              />
            ))}
          </div>
        )}

        {/* Transcript display */}
        {(transcript ||
          voiceIO.interimTranscript ||
          voiceIO.finalTranscript) && (
          <div className={styles.transcriptBox}>
            <div className={styles.label}>You said:</div>
            <div className={styles.transcript}>
              {transcript ||
                voiceIO.finalTranscript ||
                voiceIO.interimTranscript}
            </div>
          </div>
        )}

        {/* Response display with karaoke highlighting */}
        {response && (
          <div className={styles.responseBox}>
            <div className={styles.label}>Assistant:</div>
            <div className={styles.response}>
              <span className={styles.spoken}>
                {response.slice(0, spokenIndex)}
              </span>
              <span className={styles.unspoken}>
                {response.slice(spokenIndex)}
              </span>
            </div>
          </div>
        )}

        {/* Error display */}
        {(voiceIO.error || toolLoop.error) && (
          <div className={styles.errorBox}>
            {voiceIO.error || toolLoop.error}
          </div>
        )}

        {/* Status */}
        <div className={styles.status}>
          <span className={`${styles.statusDot} ${styles[appState]}`} />
          {appState === "idle" && "Ready"}
          {appState === "listening" && "Listening for speech..."}
          {appState === "thinking" && "Processing..."}
          {appState === "speaking" && "Speaking (interrupt by talking)"}
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceAssistApp />
  </StrictMode>,
);
