import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

// For local development this points to FastAPI on port 8000.
// For deployment, set VITE_API_BASE_URL to your public backend URL.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

 type CallState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";
 type Speaker = "You" | "Aria" | "System";
 type TranscriptEntry = { id: string; speaker: Speaker; text: string; time: string };
 type Order = {
  order_id?: string;
  id?: string;
  customer_name?: string;
  customer?: string;
  product?: string;
  product_name?: string;
  order_value?: number | string;
  amount?: number | string;
  status?: string;
  carrier?: string | null;
  tracking_number?: string | null;
  estimated_delivery?: string;
  notes?: string;
  [key: string]: unknown;
};

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = { 0: SpeechRecognitionAlternativeLike; isFinal: boolean };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type ChatResponse = { reply?: string; detail?: unknown };

const AGENT_INSTRUCTIONS = `You are Aria, the friendly, professional voice support agent for Aura Skincare, a premium organic Indian skincare brand.
Speak naturally, politely, and concisely in clear, simple English.
Help with skincare products, orders, shipping, returns, damaged products, and cancellations.
Policies: delivery usually takes 3–5 business days; orders below ₹499 have a ₹50 shipping fee; returns are accepted within 7 days for unopened, unused products in original packaging; damaged products must be reported within 48 hours with photos and replacement is subject to review; orders can only be cancelled while Processing; COD is available up to ₹2,500 by cash or UPI.
Never invent order details, claim an order was changed or cancelled, promise a refund, or claim an action succeeded without confirmation. If a question requires a live order lookup or action you cannot verify, explain that limitation and ask the customer to use the order support panel. For unrelated requests, politely explain that you only support Aura Skincare queries.`;

function currentTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function orderId(order: Order) { return String(order.order_id ?? order.id ?? "Unknown order"); }
function orderCustomer(order: Order) { return String(order.customer_name ?? order.customer ?? "Customer not listed"); }
function orderProduct(order: Order) { return String(order.product ?? order.product_name ?? "Product not listed"); }
function orderAmount(order: Order) {
  const amount = order.order_value ?? order.amount;
  if (amount === undefined || amount === null || amount === "") return "Not listed";
  if (typeof amount === "number") return `₹${amount.toLocaleString("en-IN")}`;
  const value = String(amount);
  return value.startsWith("₹") ? value : `₹${value}`;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "An unexpected error occurred."; }
function statusClass(status: unknown) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("deliver")) return "status-pill status-pill--green";
  if (normalized.includes("process")) return "status-pill status-pill--amber";
  if (normalized.includes("cancel")) return "status-pill status-pill--red";
  return "status-pill";
}

function LeafMark() {
  return <svg viewBox="0 0 40 40" aria-hidden="true" className="brand-mark"><rect x="1" y="1" width="38" height="38" rx="13" fill="currentColor" opacity=".1"/><path d="M28.7 10.7C18.9 10.7 11 14.9 11 23.2c0 3.3 2.1 5.5 5.3 5.5 8.2 0 12.4-8 12.4-18Z" fill="currentColor"/><path d="M10.5 30c3.1-6.1 7.5-10.2 13.7-13.4" fill="none" stroke="#f8f5ed" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"/></svg>; }
function SparkleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.2 18-3.8-7-7-3.8L21 3Z"/><path d="M10 14 21 3"/></svg>; }

export default function App() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isCallActive, setIsCallActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const listeningTimerRef = useRef<number | null>(null);
  const beginListeningRef = useRef<(() => void) | null>(null);

  const addTranscript = useCallback((speaker: Speaker, text: string) => {
    const cleaned = text.trim();
    if (!cleaned || !mountedRef.current) return;
    setTranscript(previous => [...previous, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, speaker, text: cleaned, time: currentTime() }]);
  }, []);

  const stopRecognition = useCallback(() => {
    if (listeningTimerRef.current !== null) {
      window.clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = null;
    }
    try { recognitionRef.current?.abort(); } catch { /* no active recognition */ }
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const endCall = useCallback((showMessage = true) => {
    activeRef.current = false;
    busyRef.current = false;
    stopRecognition();
    setIsCallActive(false);
    setIsProcessing(false);
    setCallState("idle");
    setErrorMessage("");
    if (showMessage) addTranscript("System", "Call ended. The microphone is no longer listening.");
  }, [addTranscript, stopRecognition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      if (listeningTimerRef.current !== null) window.clearTimeout(listeningTimerRef.current);
      try { recognitionRef.current?.abort(); } catch { /* ignore during unmount */ }
      window.speechSynthesis?.cancel();
    };
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError("");
    try {
      const response = await fetch(`${API_BASE_URL}/orders`);
      if (!response.ok) throw new Error(`Orders request failed (${response.status}).`);
      const data: unknown = await response.json();
      const list = Array.isArray(data) ? data :
        data && typeof data === "object" && "orders" in data && Array.isArray((data as { orders: unknown }).orders)
          ? (data as { orders: unknown[] }).orders : [];
      if (!list.every(item => item && typeof item === "object")) throw new Error("The orders API returned an unexpected response.");
      if (mountedRef.current) setOrders(list as Order[]);
    } catch (error) {
      if (mountedRef.current) setOrdersError(`${errorText(error)} Check that the FastAPI backend is running and its CORS settings allow this frontend.`);
    } finally {
      if (mountedRef.current) setOrdersLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const speakAndResume = useCallback((reply: string) => {
    if (!activeRef.current) return;
    setCallState("speaking");
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "en-IN";
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    const resume = () => {
      if (activeRef.current) {
        listeningTimerRef.current = window.setTimeout(() => beginListeningRef.current?.(), 250);
      }
    };
    utterance.onend = resume;
    utterance.onerror = resume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const processMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    setIsProcessing(true);
    setErrorMessage("");
    const voiceSession = activeRef.current;
    if (voiceSession) setCallState("thinking");
    addTranscript("You", message);
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${AGENT_INSTRUCTIONS}\n\nCustomer says: ${message}` }),
      });
      const data = await response.json().catch(() => ({})) as ChatResponse;
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Chat request failed (${response.status}).`);
      const reply = typeof data.reply === "string" ? data.reply.trim() : "";
      if (!reply) throw new Error("Aria returned an empty response. Please try again.");
      addTranscript("Aria", reply);
      busyRef.current = false;
      setIsProcessing(false);
      if (activeRef.current) speakAndResume(reply);
      else setCallState("idle");
    } catch (error) {
      const messageError = errorText(error);
      setErrorMessage(messageError);
      addTranscript("System", `Aria could not respond: ${messageError}`);
      busyRef.current = false;
      setIsProcessing(false);
      if (activeRef.current) {
        setCallState("listening");
        listeningTimerRef.current = window.setTimeout(() => beginListeningRef.current?.(), 350);
      } else setCallState("idle");
    }
  }, [addTranscript, speakAndResume]);

  const beginListening = useCallback(() => {
    if (!activeRef.current || busyRef.current) return;
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setErrorMessage("Speech recognition is not supported in this browser. Open this page in the latest Google Chrome.");
      setCallState("error");
      activeRef.current = false;
      setIsCallActive(false);
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-IN";
      recognition.onresult = event => {
        let spoken = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) spoken += event.results[i][0].transcript;
        }
        if (spoken.trim()) void processMessage(spoken.trim());
      };
      recognition.onerror = event => {
        if (!activeRef.current || event.error === "aborted") return;
        if (event.error === "no-speech") return;
        setErrorMessage(`Microphone recognition issue: ${event.error ?? "unknown error"}. Check browser microphone permission.`);
        setCallState("error");
        activeRef.current = false;
        setIsCallActive(false);
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (activeRef.current && !busyRef.current) {
          setCallState("listening");
          listeningTimerRef.current = window.setTimeout(() => beginListeningRef.current?.(), 400);
        }
      };
      recognitionRef.current = recognition;
      setCallState("listening");
      recognition.start();
    } catch (error) {
      setErrorMessage(errorText(error));
      setCallState("error");
      activeRef.current = false;
      setIsCallActive(false);
    }
  }, [processMessage]);
  beginListeningRef.current = beginListening;

  const startCall = useCallback(async () => {
    if (activeRef.current || callState === "connecting") return;
    setErrorMessage("");
    setCallState("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable. Open the app on localhost or HTTPS.");
      const speechWindow = window as SpeechWindow;
      if (!(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition)) {
        throw new Error("Speech recognition is not supported here. Please use the latest Google Chrome.");
      }
      addTranscript("System", "Requesting microphone permission…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.getTracks().forEach(track => track.stop());
      activeRef.current = true;
      setIsCallActive(true);
      addTranscript("System", "Connected to Aria. You can speak after the greeting.");
      await processMessage("Greet the customer briefly as Aria from Aura Skincare and ask how you can help today.");
    } catch (error) {
      activeRef.current = false;
      setIsCallActive(false);
      setCallState("error");
      setErrorMessage(errorText(error));
      addTranscript("System", `Could not start the call: ${errorText(error)}`);
    }
  }, [addTranscript, callState, processMessage]);

  const handleTextSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isProcessing) return;
    if (activeRef.current) {
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setDraft("");
    void processMessage(message);
  };

  const copyTranscript = async () => {
    if (transcript.length === 0) { setErrorMessage("There is no transcript to copy yet."); return; }
    const content = transcript.map(entry => `[${entry.time}] ${entry.speaker}: ${entry.text}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(content);
      setErrorMessage("");
      addTranscript("System", "Transcript copied to clipboard.");
    } catch {
      setErrorMessage("Clipboard access failed. Your browser may require HTTPS; you can still select and copy the transcript.");
    }
  };

  const downloadTranscript = () => {
    if (transcript.length === 0) { setErrorMessage("There is no transcript to download yet."); return; }
    const payload = {
      brand: "Aura Skincare",
      assistant: "Aria",
      exported_at: new Date().toISOString(),
      message_count: transcript.filter(item => item.speaker !== "System").length,
      transcript: transcript.map(({ speaker, text, time }) => ({ speaker, time, text })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aura-call-transcript-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const clearTranscript = () => {
    if (activeRef.current || busyRef.current) return;
    setTranscript([]);
    setErrorMessage("");
  };

  const statusMeta: Record<CallState, { label: string; hint: string }> = {
    idle: { label: "Ready to help", hint: "Start a voice call or type a question below." },
    connecting: { label: "Connecting", hint: "Approve microphone access in your browser." },
    listening: { label: "Listening", hint: "Speak naturally. Aria is listening to you." },
    thinking: { label: "Thinking", hint: "Aria is preparing a helpful response." },
    speaking: { label: "Speaking", hint: "Aria is replying. She will listen again after speaking." },
    error: { label: "Needs attention", hint: "Check the message below and try again." },
  };

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="topbar">
          <a className="brand-lockup" href="#top" aria-label="Aura Skincare home">
            <LeafMark />
            <span className="brand-copy"><strong>AURA</strong><small>SKINCARE</small></span>
          </a>
          <div className="topbar-right">
            <span className="environment-label"><span className="environment-dot" /> AI CUSTOMER CARE</span>
            <span className="topbar-divider" />
            <span className="assistant-name"><span className="mini-avatar">A</span> Aria</span>
          </div>
        </header>

        <section className="hero" id="top">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL SKINCARE GUIDE</span>
            <h1>A little care.<br /><em>A lot of confidence.</em></h1>
            <p>Meet Aria, your Aura Skincare assistant. Get thoughtful help with products, delivery, and customer care — in your own words.</p>
            <div className="hero-trust-row">
              <span><span className="trust-check">✓</span> Product guidance</span>
              <span><span className="trust-check">✓</span> Order support</span>
              <span><span className="trust-check">✓</span> Policy answers</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Aura Skincare botanical illustration">
            <div className="hero-art-circle hero-art-circle--one" />
            <div className="hero-art-circle hero-art-circle--two" />
            <div className="botanical botanical--left"><span /><span /><span /><i /></div>
            <div className="botanical botanical--right"><span /><span /><span /><i /></div>
            <div className="hero-product"><div className="product-cap" /><div className="product-bottle"><span className="product-brand">AURA</span><span className="product-rule" /><span className="product-name">daily<br />glow</span><span className="product-sub">BOTANICAL SERUM</span><div className="product-leaf">✳</div></div><div className="product-shadow" /></div>
            <div className="art-label"><SparkleIcon /><span>Gentle care, everyday</span></div>
          </div>
        </section>

        <div className="section-heading">
          <div><span className="eyebrow">LET'S TALK</span><h2>How can we help you today?</h2></div>
          <span className="privacy-note"><span className="privacy-dot" /> Demo environment</span>
        </div>

        <section className="workspace-grid" aria-label="Voice assistant workspace">
          <article className="panel voice-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">VOICE ASSISTANT</span><h3>Talk to Aria</h3></div>
              <span className={`state-badge state-badge--${callState}`}><span className="state-dot" /> {statusMeta[callState].label}</span>
            </div>
            <p className="panel-description">Ask a question out loud and Aria will respond with a natural spoken answer.</p>

            <div className={`voice-stage voice-stage--${callState}`}>
              <div className="orbit orbit--outer" /><div className="orbit orbit--inner" />
              <div className="voice-orb"><span className="orb-letter">A</span><span className="orb-leaf">✳</span></div>
              <div className="voice-wave" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
              <div className="voice-status-text"><strong>{statusMeta[callState].label}</strong><span>{statusMeta[callState].hint}</span></div>
            </div>

            <div className="voice-actions">
              <button type="button" className="button button--primary" onClick={() => void startCall()} disabled={isCallActive || callState === "connecting" || isProcessing}>
                <MicIcon /> {callState === "connecting" ? "Connecting…" : isCallActive ? "Call in progress" : "Start voice call"}
              </button>
              <button type="button" className="button button--secondary" onClick={() => endCall(true)} disabled={!isCallActive}>
                End call
              </button>
            </div>

            <div className="voice-footnote"><span className="footnote-icon">i</span><span>Allow microphone access when prompted. Voice input works best in the latest version of Google Chrome.</span></div>
            {errorMessage && <div className="error-banner" role="alert"><strong>Something needs attention</strong><span>{errorMessage}</span></div>}
          </article>

          <article className="panel transcript-panel">
            <div className="panel-heading transcript-heading">
              <div><span className="panel-kicker">LIVE SESSION</span><h3>Conversation</h3></div>
              <span className="message-count">{transcript.filter(item => item.speaker !== "System").length} messages</span>
            </div>
            <p className="panel-description">Your conversation appears here so you can review what was asked and answered.</p>

            <div className="transcript-list" aria-live="polite" aria-label="Call transcript">
              {transcript.length === 0 ? (
                <div className="transcript-empty"><div className="empty-icon"><SparkleIcon /></div><strong>Your conversation starts here</strong><span>Start a call or send a written question to see your transcript.</span></div>
              ) : transcript.map(entry => (
                <div className={`transcript-entry transcript-entry--${entry.speaker.toLowerCase()}`} key={entry.id}>
                  <div className="entry-avatar">{entry.speaker === "Aria" ? <SparkleIcon /> : entry.speaker === "You" ? "Y" : "•"}</div>
                  <div className="entry-body"><div className="entry-meta"><strong>{entry.speaker === "Aria" ? "Aria · Aura assistant" : entry.speaker}</strong><time>{entry.time}</time></div><p>{entry.text}</p></div>
                </div>
              ))}
              {isProcessing && <div className="typing-row"><span /><span /><span /> <small>Aria is thinking…</small></div>}
            </div>

            <form className="message-composer" onSubmit={handleTextSubmit}>
              <label className="sr-only" htmlFor="message-input">Type your question</label>
              <input id="message-input" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a question instead…" maxLength={1200} disabled={isProcessing} />
              <button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || isProcessing}><SendIcon /></button>
            </form>
            <div className="transcript-tools">
              <button type="button" className="text-button" onClick={() => void copyTranscript()}>Copy transcript</button>
              <button type="button" className="text-button" onClick={downloadTranscript}>Export JSON</button>
              <button type="button" className="text-button text-button--muted" onClick={clearTranscript} disabled={isCallActive || isProcessing || transcript.length === 0}>Clear</button>
            </div>
          </article>
        </section>

        <section className="orders-section" aria-labelledby="orders-title">
          <div className="section-heading section-heading--orders">
            <div><span className="eyebrow">ORDER SUPPORT</span><h2 id="orders-title">Sample order lookup</h2><p>Use these mock orders to test the support experience.</p></div>
            <button type="button" className="button button--light" onClick={() => void loadOrders()} disabled={ordersLoading}>{ordersLoading ? "Refreshing…" : "↻ Refresh orders"}</button>
          </div>
          {ordersLoading && <div className="orders-state"><span className="loader" /> Loading sample orders…</div>}
          {ordersError && <div className="error-banner error-banner--orders" role="alert"><strong>Couldn't load sample orders</strong><span>{ordersError}</span></div>}
          {!ordersLoading && !ordersError && orders.length === 0 && <div className="orders-state">No sample orders were returned by the backend.</div>}
          {!ordersLoading && !ordersError && orders.length > 0 && (
            <div className="orders-grid">{orders.map((order, index) => (
              <article className="order-card" key={`${orderId(order)}-${index}`}>
                <div className="order-card-top"><span className="order-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v10M7.5 5l9 4"/></svg></span><span className="order-code">{orderId(order)}</span><span className={statusClass(order.status)}>{String(order.status ?? "Status unavailable")}</span></div>
                <h4>{orderProduct(order)}</h4>
                <p className="order-customer">For {orderCustomer(order)}</p>
                <div className="order-divider" />
                <div className="order-info-row"><span>Order value</span><strong>{orderAmount(order)}</strong></div>
                {order.carrier && <div className="order-info-row"><span>Carrier</span><strong>{String(order.carrier)}</strong></div>}
                {order.estimated_delivery && <div className="order-info-row"><span>Estimated delivery</span><strong>{String(order.estimated_delivery)}</strong></div>}
                {order.tracking_number && <div className="order-info-row"><span>Tracking number</span><strong>{String(order.tracking_number)}</strong></div>}
                {order.notes && <p className="order-note">{String(order.notes)}</p>}
              </article>
            ))}</div>
          )}
          <p className="orders-disclaimer">These are mock assessment records, not live customer orders. No cancellation or refund is performed by this panel.</p>
        </section>

        <footer className="footer"><a className="footer-brand" href="#top"><LeafMark /> AURA SKINCARE</a><span>Thoughtful support, rooted in care.</span><span className="footer-tech">React · FastAPI · Groq</span></footer>
      </div>
    </main>
  );
}
