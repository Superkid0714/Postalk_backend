import { handleMerchantPublish } from "@/lib/instagram/merchant-publish";

export async function POST(request: Request) {
  return handleMerchantPublish(request, undefined, "video");
}
