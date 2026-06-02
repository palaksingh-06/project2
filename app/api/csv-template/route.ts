import { getBatchCsvTemplate } from "@/lib/csv/template";

export async function GET() {
  const csv = getBatchCsvTemplate();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="zbc-batch-template.csv"',
    },
  });
}
