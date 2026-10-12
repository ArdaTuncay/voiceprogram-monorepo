/**
 * A stand-in for the browser's WebSocket, installed as the global
 * `WebSocket` (vi.stubGlobal) so services/socket.ts's real Phoenix client —
 * Socket, Channel, Push, none of it mocked — talks to this instead of a
 * server. Each instance records every frame Phoenix sends, and lets a test
 * play the server's part: accept the connection, reply to one specific
 * frame, or drop the connection the way a network failure would (after
 * which Phoenix reconnects on its own, through a brand-new instance).
 */

export interface Frame {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  /** The most recently created connection — the live one after a reconnect. */
  static latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no FakeWebSocket has been created yet');
    return ws;
  }

  /** Every frame with this topic/event, across every connection so far —
   * how a test counts e.g. join attempts that span a reconnect. */
  static framesEverywhere(topic: string, event: string): Frame[] {
    return FakeWebSocket.instances.flatMap((ws) => ws.frames(topic, event));
  }

  readonly url: string;
  readyState = CONNECTING;
  binaryType = 'arraybuffer';
  bufferedAmount = 0;
  readonly sent: Frame[] = [];

  onopen: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    const [joinRef, ref, topic, event, payload] = JSON.parse(data);
    const frame: Frame = { joinRef, ref, topic, event, payload };
    this.sent.push(frame);
    // Answered automatically, like a healthy server would — otherwise a
    // test that advances past Phoenix's 30s heartbeat interval would see the
    // client tear the connection down over a "missed" heartbeat.
    if (topic === 'phoenix' && event === 'heartbeat') {
      queueMicrotask(() => this.reply(frame, 'ok'));
    }
  }

  close(code = 1000): void {
    this.readyState = CLOSED;
    this.onclose?.({ code });
  }

  // ── The server's side ──

  /** Accepts the connection — Phoenix then flushes any buffered pushes
   * (joins included) onto it. */
  open(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }

  /** Replies to one frame Phoenix sent, the way a channel's
   * `{:reply, ...}`/join return value does. */
  reply(frame: Frame, status: 'ok' | 'error', response: unknown = {}): void {
    this.onmessage?.({
      data: JSON.stringify([frame.joinRef, frame.ref, frame.topic, 'phx_reply', { status, response }]),
    });
  }

  /** An abnormal close (1006) — what a dropped network connection looks
   * like to the client, which then schedules its own reconnect. */
  drop(): void {
    this.readyState = CLOSED;
    this.onclose?.({ code: 1006 });
  }

  frames(topic: string, event: string): Frame[] {
    return this.sent.filter((f) => f.topic === topic && f.event === event);
  }

  lastFrame(topic: string, event: string): Frame {
    const frame = this.frames(topic, event).at(-1);
    if (!frame) throw new Error(`no "${event}" frame sent on "${topic}"`);
    return frame;
  }
}
