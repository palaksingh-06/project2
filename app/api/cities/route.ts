import { NextResponse } from "next/server";
import { getCitiesCache } from "@/lib/config";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const cities = getCitiesCache();
  const filtered = q
    ? cities.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.state.toLowerCase().includes(q)
      )
    : cities;
  return NextResponse.json({
    cities: filtered.slice(0, 20).map((c) => ({
      name: c.name,
      state: c.state,
      label: `${c.name}, ${c.state}`,
    })),
  });
}
