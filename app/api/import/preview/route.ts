import { NextRequest, NextResponse } from "next/server";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

// Accepts an uploaded VIP/Ekos export file and returns detected column
// headers + a small preview of rows, so the UI can ask the user which
// column is Product / On Hand / Rate of Sale before actually importing.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { headers, rows } = await parseSpreadsheet(buffer, file.name);
    return NextResponse.json({ headers, previewRows: rows.slice(0, 15), totalRows: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse file" },
      { status: 400 }
    );
  }
}
