import { handleMerchantPublish } from "@/lib/instagram/merchant-publish";

type Context = { params: Promise<{ id: string }> };

/** Compatibility with the deployed frontend: success means Instagram confirmed publication. */
export async function POST(request: Request, context: Context) {
  return handleMerchantPublish(request, (await context.params).id, undefined, { waitForCompletion: true });
}
