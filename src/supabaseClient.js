import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xywtiymqveurtuxjzxqi.supabase.co';
const supabaseKey = 'sb_publishable_s1kAadfMiXsiTw3h55k7og_CBSGOzEh';

export const supabase = createClient(supabaseUrl, supabaseKey);
