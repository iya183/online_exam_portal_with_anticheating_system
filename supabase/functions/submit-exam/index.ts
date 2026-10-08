// Supabase Edge Function: submit-exam
// Alternative HTTP wrapper around submit_attempt RPC.
// Deploy: supabase functions deploy submit-exam

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { attempt_id, answers, submit_reason, force_violated } = await req.json()

    if (!attempt_id || !answers) {
      return new Response(JSON.stringify({ error: 'attempt_id and answers required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data, error } = await supabase.rpc('submit_attempt', {
      p_attempt_id: attempt_id,
      p_answers: answers,
      p_submit_reason: submit_reason || 'Candidate finalized test.',
      p_force_violated: !!force_violated,
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const row = Array.isArray(data) ? data[0] : data
    // Return score only — never correct answers
    return new Response(
      JSON.stringify({
        score: row.score,
        max_score: row.max_score,
        status: row.status,
        violation_count: row.violation_count,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
