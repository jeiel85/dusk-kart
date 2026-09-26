import { joinRoom, selfId } from 'trystero';

/**
 * Serverless multiplayer: browsers find each other through public Nostr
 * relays (Trystero) and then talk directly over WebRTC data channels.
 * Every client simulates its own kart and broadcasts snapshots; the peer
 * with the smallest id acts as race director (start signal, grid order).
 */
export const APP_ID = 'dusk-kart.lumen-park.v1';
const INTERP_DELAY = 110; // ms of buffering for smooth remote karts

function turnConfig() {
  // Optional TURN relay for strict NATs, configured at build time.
  const urls = import.meta.env?.VITE_TURN_URLS;
  if (!urls) return undefined;
  return [{
    urls: urls.split(',').map((s) => s.trim()),
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  }];
}

export const now = () => performance.timeOrigin + performance.now();

export function randomRoomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (const v of buf) s += abc[v % abc.length];
  return s;
}

export class NetSession {
  constructor(code, profile, handlers = {}) {
    this.code = code;
    this.profile = profile;
    this.handlers = handlers;
    this.selfId = selfId;
    this.peers = new Map();
    this.room = joinRoom({ appId: APP_ID, turnConfig: turnConfig() }, `room-${code}`, {
      onJoinError: (d) => handlers.onError?.(`연결 실패 (${d.error || 'WebRTC'}) — 방화벽/NAT 환경일 수 있습니다.`),
    });

    const act = (name) => this.room.makeAction(name);
    this.aProfile = act('profile');
    this.aState = act('state');
    this.aRace = act('race');
    this.aFin = act('fin');
    this.aPing = act('ping');
    this.aPong = act('pong');

    this.room.onPeerJoin = (id) => {
      this.peer(id);
      this.aProfile.send(this.profile, { target: id });
      this.aPing.send({ t0: now() }, { target: id });
      handlers.onPeerJoin?.(id);
    };
    this.room.onPeerLeave = (id) => {
      this.peers.delete(id);
      handlers.onPeerLeave?.(id);
    };
    this.aProfile.onMessage = (p, { peerId }) => {
      const peer = this.peer(peerId);
      peer.profile = {
        name: String(p?.name || 'Driver').slice(0, 14),
        color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#ff8800',
        number: Math.max(1, Math.min(99, Number(p?.number) | 0 || 7)),
      };
      handlers.onProfile?.(peerId, peer.profile);
    };
    this.aPing.onMessage = (m, { peerId }) => this.aPong.send({ t0: m.t0, t1: now() }, { target: peerId });
    this.aPong.onMessage = (m, { peerId }) => {
      const t = now();
      const rtt = t - m.t0;
      const peer = this.peer(peerId);
      if (rtt >= 0 && rtt < 5000 && rtt <= peer.bestRtt * 1.3 + 5) {
        peer.bestRtt = Math.min(peer.bestRtt, rtt);
        peer.offset = m.t1 - (m.t0 + rtt / 2);
        peer.rtt = rtt;
      }
    };
    this.aState.onMessage = (s, { peerId }) => {
      if (!Array.isArray(s) || s.length < 14 || !s.every(Number.isFinite)) return;
      const peer = this.peer(peerId);
      peer.snaps.push(s);
      if (peer.snaps.length > 30) peer.snaps.shift();
      peer.lastSeen = now();
    };
    this.aRace.onMessage = (m, { peerId }) => handlers.onRace?.(m, peerId);
    this.aFin.onMessage = (m, { peerId }) => handlers.onFinish?.(m, peerId);

    this.pingTimer = setInterval(() => {
      for (const id of this.peers.keys()) this.aPing.send({ t0: now() }, { target: id });
    }, 2000);
  }

  peer(id) {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, profile: null, snaps: [], offset: 0, bestRtt: Infinity, rtt: 0, lastSeen: now() };
      this.peers.set(id, p);
    }
    return p;
  }

  /** Peer ids that have introduced themselves, plus us. */
  members() {
    return [this.selfId, ...[...this.peers.values()].filter((p) => p.profile).map((p) => p.id)];
  }

  get hostId() { return this.members().sort()[0]; }
  get isHost() { return this.hostId === this.selfId; }

  /** Convert a timestamp on `peerId`'s clock to ours. */
  toLocal(t, peerId) {
    const p = this.peers.get(peerId);
    return p ? t - p.offset : t;
  }

  setProfile(profile) {
    this.profile = profile;
    this.aProfile.send(profile);
  }

  /** [t, x, z, heading, vx, vz, omega, steer, rpm, throttle, progress, lapFlags, s, lateral] */
  sendState(arr) { this.aState.send(arr); }
  sendRace(msg) { this.aRace.send(msg); }
  sendFinish(msg) { this.aFin.send(msg); }

  /** Interpolated pose of a remote kart at our current time. */
  sample(peerId) {
    const p = this.peers.get(peerId);
    if (!p || p.snaps.length === 0) return null;
    const t = now() + p.offset - INTERP_DELAY;
    const S = p.snaps;
    let a = S[0], b = S[S.length - 1];
    if (t >= b[0]) {
      // Extrapolate briefly, then hold.
      const dt = Math.min(0.25, (t - b[0]) / 1000);
      return snapToPose(b, dt);
    }
    for (let i = S.length - 1; i > 0; i--) {
      if (S[i - 1][0] <= t) { a = S[i - 1]; b = S[i]; break; }
    }
    if (t <= a[0]) return snapToPose(a, 0);
    const k = (t - a[0]) / Math.max(1, b[0] - a[0]);
    const pa = snapToPose(a, 0), pb = snapToPose(b, 0);
    let dh = pb.heading - pa.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * k,
      z: pa.z + (pb.z - pa.z) * k,
      heading: pa.heading + dh * k,
      steer: pa.steer + (pb.steer - pa.steer) * k,
      rpm: pa.rpm + (pb.rpm - pa.rpm) * k,
    };
  }

  stale(peerId, ms = 4000) {
    const p = this.peers.get(peerId);
    return !p || now() - p.lastSeen > ms;
  }

  leave() {
    clearInterval(this.pingTimer);
    try { this.room.leave(); } catch { /* already gone */ }
  }
}

function snapToPose(s, dt) {
  return {
    t: s[0],
    x: s[1] + s[4] * dt,
    z: s[2] + s[5] * dt,
    heading: s[3] + s[6] * dt,
    vx: s[4], vz: s[5], omega: s[6], steer: s[7], rpm: s[8], throttle: s[9],
    progress: s[10], flags: s[11], s: s[12], lateral: s[13],
  };
}
