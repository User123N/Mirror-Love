export type SessionStatus = 'waiting' | 'live' | 'ended';
export interface MirrorSession {
  id: string;
  host_id: string;
  viewer_id: string | null;
  invite_code: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}
export interface SignalMessage {
  id: number;
  session_id: string;
  sender_id: string;
  kind: 'offer' | 'answer' | 'ice' | 'hangup';
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, never>;
  created_at: string;
}
