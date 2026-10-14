import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://127.0.0.1:8000";

type CallState = "Idle" | "Connecting" | "Listening" | "Thinking" | "Speaking" | "Error";
type TranscriptEntry = {
  id: string;
  speaker: "You" | "Aria" | "System";
  text: string;
  time: string;
};
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

const AGENT_INSTRUCTIONS = `You are Aria, the friendly, professional voice support agent for Aura Skincare, a premium organic Indian skincare brand.
Speak naturally, politely, and concisely in clear, simple English.
Help with skincare products, orders, shipping, returns, damaged products, and cancellations.
Policies: delivery usually takes 3–5 business days; orders below ₹499 have a ₹50 shipping fee; returns are accepted within 7 days for unopened, unused products in original packaging; damaged products must be reported within 48 hours with photos and replacement is subject to review; orders can only be cancelled while Processing; COD is available up to ₹2,500 by cash or UPI.
Never invent order details, claim an order was changed or cancelled, promise a refund, or claim an action succeeded without confirmation. If a question requires a live order lookup or action you cannot verify, explain that limitation and ask the customer to use the order support panel. For unrelated requests, politely explain that you only support Aura Skincare queries.`;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f7f8f4", color: "#24332c", padding: "28px 16px", fontFamily: "inherit" },
  container: { maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 24 },
  brand: { margin: 0, fontSize: 28, fontWeight: 750, letterSpacing: "-0.7px" },
  subtitle: { margin: "7px 0 0", color: "#65746b", fontSize: 14 },
  badge: { background: "#e1eee4", color: "#27613f", borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 700 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 20, alignItems: "start" },
  card: { background: "#fff", border: "1px solid #e4e9e3", borderRadius: 18, padding: 22, boxShadow: "0 5px 24px rgba(33,55,39,.045)", minWidth: 0 },
  cardTitle: { margin: "0 0 6px", fontSize: 18, fontWeight: 700 },
  muted: { color: "#6c7970", fontSize: 13, lineHeight: 1.6 },
  orbWrap: { display: "flex", justifyContent: "center", padding: "24px 0 18px" },
  orb: { width: 142, height: 142, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #d9f3df 0%, #83c49a 38%, #387c59 72%, #24533c 100%)", boxShadow: "0 0 0 12px #eff7ef, 0 0 45px rgba(70,148,96,.20)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 38, fontWeight: 700 },
  status: { textAlign: "center", fontSize: 18, fontWeight: 750, margin: "6px 0" },
  statusHint: { textAlign: "center", fontSize: 13, color: "#6c7970", minHeight: 22, lineHeight: 1.5 },
  buttonRow: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 },
  primaryButton: { flex: "1 1 150px", border: "none", borderRadius: 11, background: "#2f7049", color: "#fff", padding: "13px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  dangerButton: { flex: "1 1 120px", border: "1px solid #e6c9c7", borderRadius: 11, background: "#fff6f5", color: "#a23b35", padding: "13px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  disabledButton: { opacity: 0.5, cursor: "not-allowed" },
  alert: { background: "#fff5e7", border: "1px solid #f1d9b5", color: "#80551b", padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.55, marginTop: 14, overflowWrap: "anywhere" },
  transcript: { height: 310, overflowY: "auto", border: "1px solid #e8ece7", background: "#fafbf9", borderRadius: 12, padding: 12, marginTop: 16 },
  message: { padding: "10px 12px", borderRadius: 11, marginBottom: 10, background: "#edf5ee", overflowWrap: "anywhere" },
  messageYou: { background: "#eef3fa" },
  messageSystem: { background: "#f4f1e9" },
  messageMeta: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontWeight: 750, marginBottom: 5, color: "#587062" },
  messageText: { margin: 0, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" },
  orderList: { display: "grid", gap: 12, marginTop: 16 },
  orderCard: { border: "1px solid #e7ece6", borderRadius: 12, padding: 14, background: "#fcfdfb" },
  orderId: { fontSize: 14, fontWeight: 750, color: "#2f7049" },
  orderDetail: { marginTop: 5, fontSize: 13, lineHeight: 1.55, color: "#5f6d64", overflowWrap: "anywhere" },
  footer: { textAlign: "center", marginTop: 22, fontSize: 12, color: "#7a857d" },
};

function getOrderId(order: Order) { return String(order.order_id ?? order.id ?? "Unknown order"); }
function getOrderCustomer(order: Order) { return String(order.customer_name ?? order.customer ?? "Customer not listed"); }
function getOrderProduct(order: Order) { return String(order.product ?? order.product_name ?? "Product not listed"); }
function getOrderAmount(order: Order) {
  const amount = order.order_value ?? order.amount;
  if (amount === undefined || amount === null) return "Not listed";
  if (typeof amount === "number") return `₹${amount.toLocaleString("en-IN")}`;
  return amount.startsWith("₹") ? amount : `₹${amount}`;
}
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : "An unexpected error occurred."; }
function getCurrentTime() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

export default function App() {
  const [callState, setCallState] = useState<CallState>("Idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);

  const addTranscript = useCallback((speaker: TranscriptEntry["speaker"], text: string) => {
    const cleaned = text.trim();
    if (!cleaned || !mountedRef.current) return;
    setTranscript(previous => [...previous, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      speaker, text: cleaned, time: getCurrentTime(),
    }]);
  }, []);

  const stopSpeech = useCallback(() => {
    try { recognitionRef.current?.abort(); } catch { /* no active recognition */ }
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const endCall = useCallback((showMessage = true) => {
    activeRef.current = false;
    busyRef.current = false;
    stopSpeech();
    if (mountedRef.current) {
      setCallState("Idle");
      setErrorMessage("");
      if (showMessage) addTranscript("System", "Call ended. Your microphone is no longer listening.");
    }
  }, [addTranscript, stopSpeech]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      try { recognitionRef.current?.abort(); } catch { /* ignore cleanup errors */ }
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError("");
      try {
        const response = await fetch(`${API_BASE_URL}/orders`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Orders request failed (${response.status}).`);
        const data: unknown = await response.json();
        const orderList = Array.isArray(data) ? data :
          data && typeof data === "object" && "orders" in data && Array.isArray((data as { orders: unknown }).orders)
            ? (data as { orders: unknown[] }).orders : [];
        if (!orderList.every(item => item && typeof item === "object")) throw new Error("The orders API returned an unexpected response.");
        if (mountedRef.current) setOrders(orderList as Order[]);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (mountedRef.current) setOrdersError(`${getErrorMessage(error)} Make sure your FastAPI backend is running.`);
      } finally {
        if (mountedRef.current) setOrdersLoading(false);
      }
    }
    void loadOrders();
    return () => controller.abort();
  }, []);

  const speakAndResume = useCallback((reply: string) => {
    if (!activeRef.current) return;
    setCallState("Speaking");
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (activeRef.current) beginListeningRef.current?.();
    };
    utterance.onerror = () => {
      if (activeRef.current) beginListeningRef.current?.();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);
  const beginListeningRef = useRef<(() => void) | null>(null);

  const processMessage = useCallback(async (message: string) => {
    if (!activeRef.current || busyRef.current) return;
    busyRef.current = true;
    setCallState("Thinking");
    addTranscript("You", message);
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${AGENT_INSTRUCTIONS}\n\nCustomer says: ${message}` }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data && typeof data === "object" && "detail" in data ? String((data as { detail: unknown }).detail) : `Chat request failed (${response.status}).`;
        throw new Error(detail);
      }
      const reply = data && typeof data === "object" && "reply" in data ? String((data as { reply: unknown }).reply) : "";
      if (!reply.trim()) throw new Error("Aria returned an empty response.");
      addTranscript("Aria", reply);
      busyRef.current = false;
      speakAndResume(reply);
    } catch (error) {
      busyRef.current = false;
      const messageText = getErrorMessage(error);
      setErrorMessage(messageText);
      addTranscript("System", `Aria could not respond: ${messageText}`);
      if (activeRef.current) beginListeningRef.current?.();
    }
  }, [addTranscript, speakAndResume]);

  const beginListening = useCallback(() => {
    if (!activeRef.current || busyRef.current) return;
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setErrorMessage("Speech recognition is not supported in this browser. Please use the latest Google Chrome.");
      setCallState("Error");
      activeRef.current = false;
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
        if (!activeRef.current) return;
        if (event.error === "no-speech" || event.error === "aborted") {
          if (event.error === "no-speech") {
            setCallState("Listening");
            window.setTimeout(() => { if (activeRef.current && !busyRef.current) beginListeningRef.current?.(); }, 350);
          }
          return;
        }
        setErrorMessage(`Microphone recognition error: ${event.error ?? "unknown error"}. Check microphone permission and try again.`);
        setCallState("Error");
      };
      recognition.onend = () => {
        if (activeRef.current && !busyRef.current && callState !== "Error") {
          setCallState("Listening");
          window.setTimeout(() => { if (activeRef.current && !busyRef.current) beginListeningRef.current?.(); }, 250);
        }
      };
      recognitionRef.current = recognition;
      setCallState("Listening");
      recognition.start();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setCallState("Error");
    }
  }, [callState, processMessage]);
  beginListeningRef.current = beginListening;

  const startCall = useCallback(async () => {
    if (activeRef.current || callState === "Connecting") return;
    setErrorMessage("");
    setCallState("Connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable. Open the app on localhost or HTTPS.");
      const speechWindow = window as SpeechWindow;
      if (!(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition)) {
        throw new Error("Speech recognition is not supported. Please use the latest Google Chrome.");
      }
      addTranscript("System", "Requesting microphone permission…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.getTracks().forEach(track => track.stop());
      activeRef.current = true;
      addTranscript("System", "Connected to Aria using Groq. You can start speaking.");
      await processMessage("Greet the customer briefly as Aria from Aura Skincare and ask how you can help today.");
    } catch (error) {
      activeRef.current = false;
      setCallState("Error");
      setErrorMessage(getErrorMessage(error));
      addTranscript("System", `Could not start the call: ${getErrorMessage(error)}`);
    }
  }, [addTranscript, callState, processMessage]);

  const stateHint: Record<CallState, string> = {
    Idle: "Ready when you are.",
    Connecting: "Requesting microphone permission…",
    Listening: "Aria is listening. Speak naturally.",
    Thinking: "Aria is preparing a response…",
    Speaking: "Aria is speaking. Speak after she finishes.",
    Error: "Something needs your attention.",
  };
  const statusColor = callState === "Error" ? "#b64239" :
    callState === "Speaking" ? "#286bb0" :
    callState === "Connecting" || callState === "Thinking" ? "#9a6a20" :
    callState === "Listening" ? "#2f7049" : "#758078";

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div><h1 style={styles.brand}>Aura Skincare</h1><p style={styles.subtitle}>AI Voice Customer Support</p></div>
          <span style={styles.badge}>Aria · Voice Assistant</span>
        </header>
        <div style={styles.grid}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Talk to Aria</h2>
            <p style={styles.muted}>Ask about skincare products, shipping, returns, or order support.</p>
            <div style={styles.orbWrap}><div style={{ ...styles.orb, boxShadow: callState === "Speaking" ? "0 0 0 12px #eff7ef, 0 0 55px rgba(70,148,96,.45)" : styles.orb.boxShadow }} aria-hidden="true">A</div></div>
            <div style={{ ...styles.status, color: statusColor }} role="status">{callState}</div>
            <div style={styles.statusHint}>{stateHint[callState]}</div>
            <div style={styles.buttonRow}>
              <button type="button" style={{ ...styles.primaryButton, ...(callState !== "Idle" && callState !== "Error" ? styles.disabledButton : {}) }} onClick={() => void startCall()} disabled={callState !== "Idle" && callState !== "Error"}> {callState === "Connecting" ? "Connecting…" : "Start Call"} </button>
              <button type="button" style={{ ...styles.dangerButton, ...(!activeRef.current ? styles.disabledButton : {}) }} onClick={() => endCall(true)} disabled={!activeRef.current}>End Call</button>
            </div>
            {errorMessage && <div style={styles.alert} role="alert"><strong>Connection notice:</strong> {errorMessage}</div>}
            <p style={{ ...styles.muted, marginTop: 16 }}>Allow microphone access when your browser asks. Use localhost or HTTPS. Voice recognition works best in Google Chrome.</p>
          </section>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Call Transcript</h2>
            <p style={styles.muted}>Your conversation appears here as the session runs.</p>
            <div style={styles.transcript} aria-live="polite" aria-label="Voice call transcript">
              {transcript.length === 0 ? <p style={styles.muted}>No conversation yet. Select Start Call to begin.</p> :
                transcript.map(entry => <div key={entry.id} style={{ ...styles.message, ...(entry.speaker === "You" ? styles.messageYou : {}), ...(entry.speaker === "System" ? styles.messageSystem : {}) }}>
                  <div style={styles.messageMeta}><span>{entry.speaker}</span><span>{entry.time}</span></div><p style={styles.messageText}>{entry.text}</p>
                </div>)}
            </div>
            <div style={styles.buttonRow}>
              <button type="button" style={styles.primaryButton} onClick={() => {
                const text = transcript.map(entry => `[${entry.time}] ${entry.speaker}: ${entry.text}`).join("\n");
                if (!text) { setErrorMessage("There is no transcript to copy yet."); return; }
                void navigator.clipboard.writeText(text).then(() => setErrorMessage("")).catch(() => setErrorMessage("Clipboard access failed. Select and copy the transcript manually."));
              }}>Copy Transcript</button>
              <button type="button" style={styles.dangerButton} onClick={() => setTranscript([])}>Clear Transcript</button>
            </div>
          </section>
          <section style={{ ...styles.card, gridColumn: "1 / -1" }}>
            <h2 style={styles.cardTitle}>Test Orders Helper</h2>
            <p style={styles.muted}>Use these sample orders while testing the voice agent. Order information is loaded from your FastAPI backend.</p>
            {ordersLoading && <p style={styles.muted}>Loading sample orders…</p>}
            {ordersError && <div style={styles.alert} role="alert">{ordersError}</div>}
            {!ordersLoading && !ordersError && orders.length === 0 && <p style={styles.muted}>No orders were returned by the API.</p>}
            <div style={styles.orderList}>{orders.map((order, index) => <article key={getOrderId(order) + index} style={styles.orderCard}>
              <div style={styles.orderId}>{getOrderId(order)}</div>
              <div style={styles.orderDetail}><strong>Customer:</strong> {getOrderCustomer(order)}</div>
              <div style={styles.orderDetail}><strong>Product:</strong> {getOrderProduct(order)}</div>
              <div style={styles.orderDetail}><strong>Amount:</strong> {getOrderAmount(order)}</div>
              <div style={styles.orderDetail}><strong>Status:</strong> {String(order.status ?? "Not listed")}</div>
              {order.carrier && <div style={styles.orderDetail}><strong>Carrier:</strong> {String(order.carrier)}</div>}
              {order.tracking_number && <div style={styles.orderDetail}><strong>Tracking:</strong> {String(order.tracking_number)}</div>}
              {order.estimated_delivery && <div style={styles.orderDetail}><strong>Delivery:</strong> {String(order.estimated_delivery)}</div>}
              {order.notes && <div style={styles.orderDetail}><strong>Notes:</strong> {String(order.notes)}</div>}
            </article>)}</div>
          </section>
        </div>
        <footer style={styles.footer}>Aura Skincare · AI Voice Support · Groq + Browser Speech</footer>
      </div>
    </main>
  );
}
