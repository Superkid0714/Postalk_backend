import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import path from "node:path";

// Run explicitly with Node's --env-file option; no public provisioning API is exposed.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;
if (!url || !serviceKey || !appUrl) throw new Error("Supabase service credentials and public app URL are required");
const qrToken = `merchant-${randomUUID().replaceAll("-", "")}`;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await supabase.from("merchant_qr_tokens").insert({ qr_token: qrToken, status: "ready" });
if (error) throw new Error(error.message);
const target = new URL(`/api/qr-entry/${qrToken}`, appUrl).toString();
const output = path.resolve(process.argv[2] || `merchant-qr-${Date.now()}.png`);
await QRCode.toFile(output, target, { width: 512, margin: 2 });
console.log(`QR image saved: ${output}`);
