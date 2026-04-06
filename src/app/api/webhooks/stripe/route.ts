import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

// Use service role client for webhook (bypasses RLS)
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return Response.json(
      { error: `Webhook signature verification failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const searchId = session.metadata?.search_id;

    if (userId && searchId) {
      const supabase = createServiceClient();

      await supabase.from("unlocks").insert({
        user_id: userId,
        search_id: searchId,
        stripe_session_id: session.id,
        amount_usd: (session.amount_total ?? 0) / 100,
      });
    }
  }

  return Response.json({ received: true });
}
