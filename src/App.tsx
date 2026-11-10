import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, ChevronRight, CircleHelp, Copy, Eye, EyeOff, Heart, Laptop, LogOut, Monitor, MonitorUp, Radio, ShieldCheck, Signal, Square, Wifi, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, getRtcConfig } from './lib/supabase';
import { sendSignal } from './lib/signaling';
import type { MirrorSession, SignalMessage } from './lib/types';

type Notice = { type: 'error' | 'success' | 'info'; text: string } | null;
type Mode = 'home' | 'host' | 'viewer';

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [mode, setMode] = useState<Mode>('home');
  const [session, setSession] = useState<MirrorSession | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remoteName, setRemoteName] = useState('');
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const processedSignals = useRef<Set<number>>(new Set());
  const signalChannel = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const sessionWatch = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => setUser(authSession?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!streaming || !startedAt.current) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current!) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const cleanupConnection = useCallback(() => {
    signalChannel.current?.unsubscribe(); signalChannel.current = null;
    sessionWatch.current?.unsubscribe(); sessionWatch.current = null;
    pcRef.current?.getSenders().forEach(sender => sender.track?.stop());
    pcRef.current?.close(); pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop()); localStreamRef.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    remoteStreamRef.current = null;
    pendingCandidates.current = []; processedSignals.current.clear();
    startedAt.current = null; setElapsed(0); setStreaming(false); setConnected(false);
  }, []);

  useEffect(() => () => cleanupConnection(), [cleanupConnection]);

  // Video elements are conditionally rendered; attach streams again after React mounts them.
  useEffect(() => {
    if (localVideo.current && localStreamRef.current && localVideo.current.srcObject !== localStreamRef.current) {
      localVideo.current.srcObject = localStreamRef.current;
      void localVideo.current.play().catch(() => undefined);
    }
    if (remoteVideo.current && remoteStreamRef.current && remoteVideo.current.srcObject !== remoteStreamRef.current) {
      remoteVideo.current.srcObject = remoteStreamRef.current;
      void remoteVideo.current.play().catch(() => undefined);
    }
  }, [streaming, connected, mode]);

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setNotice(null);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.trim() } } });
        if (error) throw error;
        setNotice({ type: 'success', text: 'Cuenta creada. Si Supabase solicita verificar tu correo, confirma el mensaje antes de iniciar sesión.' });
        setIsSignup(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo completar la autenticación.' }); }
    finally { setBusy(false); }
  };


  const createSession = async () => {
    if (!supabase || !user) return;
    const client = supabase;
    setBusy(true); setNotice(null);
    try {
      let created: MirrorSession | null = null;
      let lastError: { message?: string; code?: string } | null = null;
      for (let attempt = 0; attempt < 4 && !created; attempt++) {
        const code = makeCode();
        const { data: sessionId, error } = await client.rpc('create_session', { p_invite_code: code });
        if (error) {
          lastError = error;
          if (error.code === '23505') continue;
          throw new Error(`Supabase (${error.code || 'sin código'}): ${error.message}${error.details ? ' — ' + error.details : ''}${error.hint ? ' — ' + error.hint : ''}`);
        }
        if (!sessionId) throw new Error('Supabase no devolvió el identificador de la sala.');
        const { data, error: fetchError } = await client.from('sessions').select('*').eq('id', sessionId).single();
        if (fetchError) throw new Error(`La sala se creó, pero no se pudo leer (${fetchError.code || 'error'}): ${fetchError.message}`);
        created = data as MirrorSession;
      }
      if (!created) throw new Error(lastError?.message || 'No se pudo generar un código único. Intenta de nuevo.');
      setSession(created); setMode('host'); setNotice({ type: 'success', text: 'Sala creada. Comparte el código con la otra persona.' });
      watchForViewer(created);
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
      setNotice({ type: 'error', text: detail || 'No se pudo crear la sala. Revisa la configuración de Supabase.' });
    } finally { setBusy(false); }
  };

  const watchForViewer = (current: MirrorSession) => {
    if (!supabase) return;
    sessionWatch.current?.unsubscribe();
    sessionWatch.current = supabase.channel(`session-watch-${current.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${current.id}` }, payload => {
        const next = payload.new as MirrorSession; setSession(next);
        if (next.viewer_id) setNotice({ type: 'success', text: 'La otra persona se ha unido. Ya puedes iniciar la transmisión.' });
        if (next.status === 'ended') { cleanupConnection(); setSession(null); setMode('home'); setNotice({ type: 'info', text: 'La sesión ha finalizado.' }); }
      }).subscribe();
  };

  const joinSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !user) return;
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { setNotice({ type: 'error', text: 'El código debe tener 8 caracteres.' }); return; }
    setBusy(true); setNotice(null);
    try {
      const { data: sessionId, error } = await supabase.rpc('join_session', { p_code: code });
      if (error) throw error;
      const { data, error: fetchError } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
      if (fetchError) throw fetchError;
      setSession(data as MirrorSession); setMode('viewer'); setRemoteName('Pantalla compartida');
      setNotice({ type: 'info', text: 'Conectando con la persona que comparte su pantalla…' });
      await startViewer(data as MirrorSession);
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo entrar a la sala.' }); }
    finally { setBusy(false); }
  };

  const createPeer = (current: MirrorSession, isHost: boolean) => {
    if (!supabase || !user) throw new Error('La sesión no está disponible.');
    // Capture narrowed, non-null references before registering asynchronous WebRTC callbacks.
    const client = supabase;
    const currentUser = user;
    const pc = new RTCPeerConnection(getRtcConfig());
    pcRef.current = pc;
    // Negotiate both directions from the beginning so either participant can share later.
    if (isHost) {
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }
    pc.onicecandidate = event => {
      if (event.candidate) {
        void sendSignal(client, current.id, currentUser.id, 'ice', event.candidate.toJSON())
          .catch(() => setNotice({ type: 'error', text: 'No se pudo enviar un candidato de conexión.' }));
      }
    };
    pc.onconnectionstatechange = () => {
      setConnected(pc.connectionState === 'connected');
      if (pc.connectionState === 'failed') setNotice({ type: 'error', text: 'No se pudo establecer la conexión. Prueba otra red o configura un servidor TURN.' });
      if (pc.connectionState === 'disconnected') setNotice({ type: 'info', text: 'Conexión interrumpida. El navegador intentará recuperarla.' });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setConnected(true);
      if (isHost && pc.iceConnectionState === 'failed' && pc.signalingState === 'stable') {
        void (async () => {
          try {
            const restartOffer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(restartOffer);
            await sendSignal(client, current.id, currentUser.id, 'offer', restartOffer);
          } catch { setNotice({ type: 'error', text: 'No fue posible recuperar la conexión. Comprueba la red e inténtalo de nuevo.' }); }
        })();
      }
    };
    pc.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = stream;
        void remoteVideo.current.play().catch(() => undefined);
      }
    };
    return pc;
  };

  const flushCandidates = async (pc: RTCPeerConnection) => {
    for (const candidate of pendingCandidates.current.splice(0)) await pc.addIceCandidate(candidate);
  };

  const handleSignal = async (message: SignalMessage, current: MirrorSession, isHost: boolean) => {
    if (!supabase || !user || message.sender_id === user.id || processedSignals.current.has(message.id)) return;
    processedSignals.current.add(message.id);
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (message.kind === 'offer' && !isHost) {
        await pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
        await flushCandidates(pc);
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        await sendSignal(supabase, current.id, user.id, 'answer', answer);
      } else if (message.kind === 'answer' && isHost) {
        await pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
        await flushCandidates(pc);
      } else if (message.kind === 'ice') {
        const candidate = message.payload as RTCIceCandidateInit;
        if (pc.remoteDescription) await pc.addIceCandidate(candidate); else pendingCandidates.current.push(candidate);
      } else if (message.kind === 'hangup') {
        cleanupConnection(); setSession(null); setMode('home'); setNotice({ type: 'info', text: 'La otra persona terminó la transmisión.' });
      }
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Error en la señalización.' }); }
  };

  const subscribeSignals = async (current: MirrorSession, isHost: boolean) => {
    if (!supabase) return;
    signalChannel.current?.unsubscribe();
    const channel = supabase.channel(`signals-${current.id}-${user?.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals', filter: `session_id=eq.${current.id}` }, payload => {
        void handleSignal(payload.new as SignalMessage, current, isHost);
      });
    signalChannel.current = channel;
    await new Promise<void>((resolve, reject) => {
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('No se pudo abrir el canal de señalización.'));
      });
    });
    // Fetch after subscribing so a signal cannot be lost between the initial query and subscription.
    const { data: existing, error } = await supabase.from('signals').select('*').eq('session_id', current.id).order('id', { ascending: true });
    if (error) throw error;
    for (const message of (existing ?? []) as SignalMessage[]) await handleSignal(message, current, isHost);
  };

  const applyLocalStream = async (stream: MediaStream, pc: RTCPeerConnection) => {
    const transceivers = pc.getTransceivers();
    for (const track of stream.getTracks()) {
      const transceiver = transceivers.find(item => item.receiver.track.kind === track.kind);
      if (!transceiver) throw new Error(`La conexión no negoció un canal de ${track.kind}. Cierra la sala y crea una nueva.`);
      await transceiver.sender.replaceTrack(track);
    }
    localStreamRef.current = stream;
    if (localVideo.current) {
      localVideo.current.srcObject = stream;
      void localVideo.current.play().catch(() => undefined);
    }
    stream.getTracks().forEach(track => track.addEventListener('ended', () => void stopLocalShare(), { once: true }));
    startedAt.current = Date.now();
    setStreaming(true);
  };

  const stopLocalShare = async () => {
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    if (pc && stream) {
      for (const track of stream.getTracks()) {
        const transceiver = pc.getTransceivers().find(item => item.receiver.track.kind === track.kind);
        if (transceiver) await transceiver.sender.replaceTrack(null).catch(() => undefined);
      }
    }
    stream?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    startedAt.current = null;
    setElapsed(0);
    setStreaming(false);
    setNotice({ type: 'info', text: 'Dejaste de compartir tu pantalla. La sala sigue abierta y puedes volver a compartir.' });
  };

  const startHost = async () => {
    if (!supabase || !user || !session) return;
    if (!session.viewer_id) { setNotice({ type: 'info', text: 'Primero espera a que la otra persona entre con tu código.' }); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setNotice({ type: 'error', text: 'Este navegador no permite compartir pantalla. Usa una versión reciente de Chrome, Edge o Firefox mediante HTTPS.' }); return; }
    setBusy(true); setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: true });
      let pc = pcRef.current;
      if (!pc) {
        pc = createPeer(session, true);
        await subscribeSignals(session, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(supabase, session.id, user.id, 'offer', offer);
        await supabase.from('sessions').update({ status: 'live' }).eq('id', session.id);
      }
      await applyLocalStream(stream, pc);
      setNotice({ type: 'success', text: 'Compartes tu pantalla. La otra persona también puede compartir la suya desde su panel.' });
    } catch (error) {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo iniciar la transmisión.' });
    } finally { setBusy(false); }
  };

  const startViewerShare = async () => {
    if (!pcRef.current || !connected) {
      setNotice({ type: 'info', text: 'Espera a que se establezca la conexión antes de compartir tu pantalla.' });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice({ type: 'error', text: 'Este navegador no permite compartir pantalla. Usa Chrome, Edge o Firefox mediante HTTPS.' });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: true });
      await applyLocalStream(stream, pcRef.current);
      setNotice({ type: 'success', text: 'Ahora ambos pueden ver las pantallas que han autorizado compartir.' });
    } catch (error) {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo compartir tu pantalla.' });
    } finally { setBusy(false); }
  };

  const startViewer = async (current: MirrorSession) => {
    if (!supabase) return;
    const pc = createPeer(current, false);
    await subscribeSignals(current, false);
    // The viewer receives the remote screen through the shared ontrack handler in createPeer.
  };

  const endSession = async (notifyPeer = true) => {
    if (supabase && user && session) {
      if (notifyPeer) await sendSignal(supabase, session.id, user.id, 'hangup', {}).catch(() => undefined);
      await supabase.from('sessions').update({ status: 'ended' }).eq('id', session.id).then(() => undefined);
    }
    cleanupConnection(); setSession(null); setMode('home');
    setNotice({ type: 'info', text: 'La sesión se ha cerrado y la captura local se ha detenido.' });
  };

  const signOut = async () => { if (session) await endSession(); else cleanupConnection(); await supabase?.auth.signOut(); setSession(null); setMode('home'); };

  const copyCode = async () => {
    if (!session) return;
    await navigator.clipboard.writeText(session.invite_code); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };

  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  if (!authReady) return <div className="boot"><div className="loader"/><span>Preparando MirrorLove…</span></div>;
  if (!isSupabaseConfigured) return <main className="setup-screen"><div className="brand-mark"><Heart size={23} fill="currentColor"/></div><span className="eyebrow">CONFIGURACIÓN INICIAL</span><h1>Conecta tu proyecto<br/><span>MirrorLove 24/7</span></h1><p>La aplicación ya está construida. Para activar cuentas, salas y transmisión, configura las credenciales de Supabase.</p><div className="setup-card"><strong>1. Crea tu archivo <code>.env</code></strong><p>Copia <code>.env.example</code> y completa la URL y la clave publicable (o anon) de tu proyecto Supabase.</p><strong>2. Ejecuta la migración SQL</strong><p>En Supabase → SQL Editor, ejecuta el archivo <code>supabase/migrations/001_initial.sql</code>.</p><strong>3. Inicia la aplicación</strong><pre>npm install<br/>npm run dev</pre></div><p className="small-muted">Nunca coloques la service_role key en variables VITE_ ni en el navegador.</p></main>;

  if (!user) return <main className="auth-layout"><section className="auth-aside"><div className="brand"><div className="brand-mark"><Heart size={21} fill="currentColor"/></div><span>MirrorLove</span><sup>24/7</sup></div><div className="aside-copy"><span className="eyebrow">CERCA, AUNQUE ESTÉN LEJOS</span><h1>Compartir también es una forma de estar.</h1><p>Una conexión privada y directa para compartir tu pantalla con alguien de confianza.</p><div className="trust-line"><ShieldCheck size={18}/> Sesiones autorizadas y controladas por ti</div></div><div className="aside-orbit orbit-one"/><div className="aside-orbit orbit-two"/><span className="aside-foot">MIRRORLOVE · CONEXIONES CON CONSENTIMIENTO</span></section><section className="auth-main"><form className="auth-card" onSubmit={handleAuth}><div className="mobile-brand"><div className="brand-mark"><Heart size={20} fill="currentColor"/></div><b>MirrorLove <sup>24/7</sup></b></div><span className="eyebrow">TU ESPACIO PRIVADO</span><h2>{isSignup ? 'Crea tu cuenta' : 'Qué bueno tenerte aquí'}</h2><p className="auth-sub">{isSignup ? 'Regístrate para empezar a compartir de forma segura.' : 'Inicia sesión para acceder a tus conexiones.'}</p>{isSignup && <label>Nombre visible<input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Cómo quieres aparecer" required minLength={2}/></label>}<label>Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" autoComplete="email" required/></label><label>Contraseña<div className="password-wrap"><input type={authPasswordVisible ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} required/><button type="button" className="icon-button" onClick={() => setAuthPasswordVisible(!authPasswordVisible)} aria-label="Mostrar u ocultar contraseña">{authPasswordVisible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>{notice && <NoticeBox notice={notice}/>}<button className="primary-button full" disabled={busy}>{busy ? 'Un momento…' : isSignup ? 'Crear cuenta' : 'Iniciar sesión'}<ChevronRight size={18}/></button><p className="switch-auth">{isSignup ? '¿Ya tienes cuenta?' : '¿Todavía no tienes cuenta?'} <button type="button" onClick={() => { setIsSignup(!isSignup); setNotice(null); }}> {isSignup ? 'Inicia sesión' : 'Regístrate'}</button></p><p className="legal-note"><ShieldCheck size={14}/> Comparte únicamente con personas a quienes hayas dado permiso.</p></form></section></main>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><Heart size={20} fill="currentColor"/></div><span>MirrorLove</span><sup>24/7</sup></div><div className="side-label">ESPACIO PERSONAL</div><button className={`nav-item ${mode === 'home' ? 'active' : ''}`} onClick={() => { if (session) void endSession(); else { cleanupConnection(); setMode('home'); } }}><Laptop size={18}/> Panel principal</button><div className="sidebar-bottom"><div className="secure-mini"><ShieldCheck size={17}/><div><b>Tu privacidad importa</b><span>Controlas cada sesión</span></div></div><div className="user-chip"><div className="avatar">{(user.email?.[0] ?? 'M').toUpperCase()}</div><div className="user-details"><b>{user.user_metadata?.display_name || 'Mi cuenta'}</b><span>{user.email}</span></div><button className="icon-button" onClick={signOut} title="Cerrar sesión"><LogOut size={17}/></button></div></div></aside><main className="main-content"><header className="topbar"><div><span className="eyebrow">TU ESPACIO DIGITAL</span><h2>{mode === 'home' ? 'Panel principal' : mode === 'host' ? 'Compartir pantalla' : 'Ver pantalla'}</h2></div><div className="topbar-status"><span className="status-dot"/> Conexión segura</div></header><div className="content-wrap">{notice && <NoticeBox notice={notice}/>} {mode === 'home' && <><section className="welcome-banner"><div className="welcome-text"><span className="eyebrow">BIENVENIDO A MIRRORLOVE</span><h1>La distancia no tiene<br/>que sentirse tan grande.</h1><p>Inicia una conexión privada. Tú decides cuándo compartir y cuándo terminar.</p></div><div className="welcome-art"><div className="art-circle"><Heart size={45} strokeWidth={1.2}/><span className="art-spark spark-a">✦</span><span className="art-spark spark-b">✧</span></div><div className="art-caption"><span className="status-dot"/> CONEXIONES EN TIEMPO REAL</div></div></section><div className="section-heading"><div><span className="eyebrow">EMPIEZA EN UN MOMENTO</span><h3>¿Qué quieres hacer?</h3></div><span className="private-tag"><ShieldCheck size={14}/> Privado por diseño</span></div><div className="action-grid"><button className="action-card" onClick={createSession} disabled={busy}><div className="action-icon pink"><MonitorUp size={24}/></div><span className="card-kicker">EMITIR</span><h3>Compartir mi pantalla</h3><p>Crea una sala privada. Después, ambos podrán compartir su pantalla y ver la del otro.</p><span className="card-link">Crear sala <ChevronRight size={16}/></span></button><form className="action-card join-card" onSubmit={joinSession}><div className="action-icon violet"><Eye size={24}/></div><span className="card-kicker">RECIBIR</span><h3>Ver una pantalla</h3><p>Introduce el código para unirte. Cuando estén conectados, también podrás compartir tu pantalla.</p><label className="code-label">CÓDIGO DE INVITACIÓN<input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="ABCD2345" maxLength={8} autoCapitalize="characters"/></label><button className="primary-button" disabled={busy || joinCode.trim().length !== 8}>{busy ? 'Conectando…' : 'Unirme a la sala'}<ChevronRight size={17}/></button></form></div><section className="how-section"><div className="section-heading"><div><span className="eyebrow">SENCILLO Y TRANSPARENTE</span><h3>Así funciona</h3></div></div><div className="steps-grid"><div className="step"><span>01</span><b>Crea o recibe un código</b><p>Una persona crea la sala y comparte su invitación.</p></div><div className="step"><span>02</span><b>Confirma el permiso</b><p>Quien comparte elige la pantalla y confirma desde su navegador.</p></div><div className="step"><span>03</span><b>Conecta y controla</b><p>Ambas personas pueden terminar la sesión cuando quieran.</p></div></div></section></>}
{mode === 'host' && session && <section className="session-layout"><div className="session-main-card"><div className="session-card-head"><div><span className="eyebrow">SALA DE TRANSMISIÓN</span><h3>Comparte tu pantalla</h3></div><span className={`live-pill ${connected ? 'is-live' : ''}`}><span className="status-dot"/>{connected ? 'Conectado' : streaming ? 'Conectando' : 'Esperando'}</span></div><div className="video-stage">{streaming ? <video ref={localVideo} autoPlay muted playsInline/> : <div className="stage-placeholder"><div className="stage-icon"><Monitor size={34}/></div><b>Tu pantalla aparecerá aquí</b><span>La captura solo comenzará cuando pulses el botón de compartir.</span></div>}</div>{connected && <div className="remote-preview"><span className="eyebrow">PANTALLA DE LA OTRA PERSONA</span><video ref={remoteVideo} autoPlay playsInline/></div>}<div className="stream-controls"><div className="stream-meta"><span><Radio size={15}/> {streaming ? 'COMPARTIENDO TU PANTALLA' : 'TU TRANSMISIÓN DETENIDA'}</span><b>{formatTime(elapsed)}</b></div>{!streaming ? <button className="primary-button" onClick={startHost} disabled={busy || !session.viewer_id}><MonitorUp size={17}/>{busy ? 'Preparando…' : session.viewer_id ? 'Compartir mi pantalla' : 'Esperando a que se una alguien'}</button> : <button className="danger-button" onClick={() => void stopLocalShare()}><Square size={16} fill="currentColor"/> Dejar de compartir</button>}</div></div><aside className="session-side"><div className="invite-card"><span className="eyebrow">INVITA A ALGUIEN</span><h3>Tu código de sala</h3><p>Compártelo solo con la persona que quieres que vea tu pantalla.</p><div className="invite-code">{session.invite_code.split('').map((char, i) => <span key={i}>{char}</span>)}</div><button className="secondary-button full" onClick={copyCode}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? 'Copiado' : 'Copiar código'}</button><div className="invite-status"><span className={`status-dot ${session.viewer_id ? 'green' : ''}`}/>{session.viewer_id ? 'La persona se ha unido' : 'Esperando a la otra persona'}</div></div><div className="privacy-card"><ShieldCheck size={20}/><b>Control total</b><p>El navegador muestra su aviso de compartir pantalla. Puedes detenerlo desde aquí o desde el propio navegador.</p></div><button className="text-button" onClick={() => void endSession()}>Cerrar sala <X size={15}/></button></aside></section>}
{mode === 'viewer' && session && <section className="session-layout viewer-layout"><div className="session-main-card"><div className="session-card-head"><div><span className="eyebrow">VISUALIZACIÓN EN DIRECTO</span><h3>{remoteName}</h3></div><span className={`live-pill ${connected ? 'is-live' : ''}`}><span className="status-dot"/>{connected ? 'En directo' : 'Conectando'}</span></div><div className="video-stage viewer-stage"><><video ref={remoteVideo} autoPlay playsInline/><div className="stage-placeholder" hidden={connected}><div className="stage-icon"><Wifi size={34}/></div><b>Esperando la transmisión</b><span>La otra persona debe elegir qué pantalla compartir y autorizarlo.</span></div></></div>{streaming && <div className="remote-preview"><span className="eyebrow">TU PANTALLA COMPARTIDA</span><video ref={localVideo} autoPlay muted playsInline/></div>}<div className="stream-controls"><div className="stream-meta"><span><Signal size={15}/> {connected ? 'CONEXIÓN ESTABLECIDA' : 'ESTABLECIENDO CONEXIÓN'}</span></div><div className="control-actions">{!streaming ? <button className="primary-button" onClick={startViewerShare} disabled={busy || !connected}><MonitorUp size={17}/>{busy ? 'Preparando…' : 'Compartir mi pantalla también'}</button> : <button className="danger-button" onClick={() => void stopLocalShare()}><Square size={16} fill="currentColor"/> Dejar de compartir</button>}<button className="secondary-button" onClick={() => void endSession()}>Salir de la sesión <LogOut size={16}/></button></div></div></div><aside className="session-side"><div className="invite-card viewer-info"><div className="action-icon violet"><Eye size={23}/></div><span className="eyebrow">SESIÓN AUTORIZADA</span><h3>Conexión entre ambos</h3><p>Puedes ver la pantalla autorizada de la otra persona y compartir la tuya simultáneamente. Cada uno controla su propia transmisión.</p><div className="invite-status"><span className={`status-dot ${connected ? 'green' : ''}`}/>{connected ? 'Recibiendo pantalla' : 'Esperando al emisor'}</div></div><div className="privacy-card"><ShieldCheck size={20}/><b>Privacidad respetada</b><p>La transmisión se realiza directamente entre navegadores cuando la red lo permite.</p></div></aside></section>}
</div><footer className="app-footer"><span>© 2026 MirrorLove 24/7</span><span><ShieldCheck size={13}/> Comparte con consentimiento. Detén cuando quieras.</span></footer></main></div>;
}

function NoticeBox({ notice }: { notice: NonNullable<Notice> }) {
  return <div className={`notice ${notice.type}`}><span>{notice.type === 'error' ? <X size={16}/> : notice.type === 'success' ? <Check size={16}/> : <CircleHelp size={16}/>}</span><p>{notice.text}</p></div>;
}
