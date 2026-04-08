import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL_MWM
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY_MWM

export const supabase = createClient(supabaseUrl, supabaseKey)
