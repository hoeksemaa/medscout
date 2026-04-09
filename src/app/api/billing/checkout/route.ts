import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { UNLOCK_PRICE_USD } from "@/lib/constants";

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchId } = await req.json();

  if (!searchId) {
    return Response.json({ error: "Missing searchId" }, { status: 400 });
  }

  // Verify the search exists and belongs to this user
  const { data: search } = await supabase
    .from("searches")
    .select("id, procedure")
    .eq("id", searchId)
    .eq("user_id", user.id)
    .single();

  if (!search) {
    return Response.json({ error: "Search not found" }, { status: 404 });
  }

  // Check if already unlocked
  const { data: existing } = await supabase
    .from("unlocks")
    .select("id")
    .eq("search_id", searchId)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return Response.json({ error: "Already unlocked" }, { status: 400 });
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    allow_promotion_codes: true,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: UNLOCK_PRICE_USD * 100,
          product_data: {
            name: `Dr. YellowPages Search Unlock`,
            description: `Full results for: ${search.procedure}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      user_id: user.id,
      search_id: searchId,
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/history/${searchId}?unlocked=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/history/${searchId}`,
  });

  return Response.json({ url: session.url });
}
