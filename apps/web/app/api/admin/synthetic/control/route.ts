import { proxySyntheticAdminRequest } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return proxySyntheticAdminRequest("/admin/synthetic/control", {
    method: "GET"
  });
}

export async function PUT(req: Request): Promise<Response> {
  return proxySyntheticAdminRequest(
    "/admin/synthetic/control",
    {
      method: "PUT",
      body: await req.text()
    }
  );
}
