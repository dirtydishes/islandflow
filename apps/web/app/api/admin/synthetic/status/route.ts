import { proxySyntheticAdminRequest } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return proxySyntheticAdminRequest("/admin/synthetic/status", {
    method: "GET"
  });
}
