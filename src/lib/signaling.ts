import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignalMessage } from './types';

export async function sendSignal(
  client: SupabaseClient,
  sessionId: string,
  senderId: string,
  kind: SignalMessage['kind'],
  payload: SignalMessage['payload'],
) {
  const { error } = await client.from('signals').insert({
    session_id: sessionId,
    sender_id: senderId,
    kind,
    payload,
  });
  if (error) throw error;
}
